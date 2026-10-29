import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

import { auditar } from "../services/operaciones.js";

const router = Router();

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["admin", "recepcionista"].includes(req.usuario.rol)) {
    return res.status(403).json({
      correcto: false,
      mensaje: "Tu cuenta no tiene permiso para gestionar cobros."
    });
  }

  next();
});

function fallo(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function leerId(valor) {
  const texto = String(valor ?? "");
  const numero = Number(texto);

  if (
    !/^[1-9]\d*$/.test(texto) ||
    !Number.isSafeInteger(numero) ||
    numero > 2147483647
  ) {
    throw fallo("El identificador no es válido.");
  }

  return numero;
}

function leerTexto(valor, maximo) {
  if (valor === undefined || valor === null || valor === "") {
    return null;
  }

  if (typeof valor !== "string" || valor.trim().length > maximo) {
    throw fallo(`El texto no puede superar ${maximo} caracteres.`);
  }

  return valor.trim() || null;
}

function manejarError(error, res, next) {
  if (error.code === "23505") {
    return res.status(409).json({
      correcto: false,
      mensaje: "La clave de esta operación ya fue utilizada."
    });
  }

  if (error.status) {
    return res.status(error.status).json({
      correcto: false,
      mensaje: error.message
    });
  }

  next(error);
}

const consultaCuentas = `
  SELECT
    c.id,
    p.nombre AS paciente,
    c.motivo,
    c.fecha_hora,
    c.importe_total,
    COALESCE(abonos.total, 0) AS total_pagado,
    c.importe_total - COALESCE(abonos.total, 0) AS saldo
  FROM public.citas c
  JOIN public.pacientes p ON p.id = c.paciente_id
  LEFT JOIN (
    SELECT cita_id, SUM(monto) AS total
    FROM public.pagos
    WHERE estado = 'pagado'
    GROUP BY cita_id
  ) abonos ON abonos.cita_id = c.id
  WHERE c.estado = 'completada'
`;

router.get("/", async (req, res, next) => {
  try {
    const buscar = req.query.buscar ?? "";
    const pagina = leerId(req.query.pagina ?? 1);

    if (
      typeof buscar !== "string" ||
      buscar.length > 150 ||
      pagina > 1000000
    ) {
      throw fallo("Los parámetros de búsqueda no son válidos.");
    }

    const resultado = await pool.query(
      `
        WITH cuentas AS (
          ${consultaCuentas}
        ),
        filtradas AS (
          SELECT *
          FROM cuentas
          WHERE strpos(lower(paciente), lower($1)) > 0
        ),
        pagina_actual AS (
          SELECT
            id,
            paciente,
            motivo,
            fecha_hora,
            importe_total::text,
            total_pagado::text,
            saldo::text
          FROM filtradas
          ORDER BY fecha_hora DESC, id DESC
          LIMIT 10 OFFSET $2
        )
        SELECT
          (
            SELECT COALESCE(
              jsonb_agg(
                to_jsonb(pa)
                ORDER BY pa.fecha_hora DESC, pa.id DESC
              ),
              '[]'::jsonb
            )
            FROM pagina_actual pa
          ) AS cuentas,
          (SELECT COUNT(*)::integer FROM filtradas) AS total,
          (
            SELECT COALESCE(SUM(importe_total), 0)::text
            FROM cuentas
          ) AS total_consultas,
          (
            SELECT COALESCE(SUM(total_pagado), 0)::text
            FROM cuentas
          ) AS pagos_recibidos,
          (
            SELECT COALESCE(SUM(saldo), 0)::text
            FROM cuentas
          ) AS saldo_pendiente
      `,
      [buscar.trim(), (pagina - 1) * 10]
    );

    const datos = resultado.rows[0];

    res.json({
      correcto: true,
      ...datos,
      total_paginas: Math.max(1, Math.ceil(datos.total / 10))
    });
  } catch (error) {
    manejarError(error, res, next);
  }
});

router.get("/citas/:id", async (req, res, next) => {
  try {
    const citaId = leerId(req.params.id);

    const cuenta = await pool.query(
      `
        WITH cuentas AS (${consultaCuentas})
        SELECT *
        FROM cuentas
        WHERE id = $1
      `,
      [citaId]
    );

    if (cuenta.rowCount === 0) {
      throw fallo("La consulta completada no existe.", 404);
    }

    const pagos = await pool.query(
      `
        SELECT
          p.id,
          p.monto,
          p.metodo_pago,
          p.estado,
          p.fecha_pago,
          p.referencia,
          p.notas,
          u.nombre AS recibido_por
        FROM public.pagos p
        LEFT JOIN public.usuarios u ON u.id = p.recibido_por
        WHERE p.cita_id = $1
        ORDER BY p.fecha_pago DESC, p.id DESC
      `,
      [citaId]
    );

    res.json({
      correcto: true,
      cuenta: cuenta.rows[0],
      pagos: pagos.rows
    });
  } catch (error) {
    manejarError(error, res, next);
  }
});

router.post("/pagos", async (req, res, next) => {
  let cliente;
  let transaccion = false;

  try {
    const cuerpo = req.body ?? {};
    const citaId = leerId(cuerpo.cita_id);
    const monto = String(cuerpo.monto ?? "");
    const metodo = cuerpo.metodo_pago;
    const clave = cuerpo.clave_operacion;

    if (
      !/^\d{1,8}(\.\d{1,2})?$/.test(monto) ||
      Number(monto) <= 0
    ) {
      throw fallo("El monto debe ser mayor que cero y tener máximo dos decimales.");
    }

    if (!["efectivo", "tarjeta", "transferencia"].includes(metodo)) {
      throw fallo("Selecciona un método de pago válido.");
    }

    if (
      typeof clave !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clave)
    ) {
      throw fallo("La clave de operación no es válida.");
    }

    const referencia = leerTexto(cuerpo.referencia, 150);
    const notas = leerTexto(cuerpo.notas, 2000);

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccion = true;

    // Todas las escrituras de pagos deben bloquear primero su cita.
    const cita = await cliente.query(
      `
        SELECT id, estado
        FROM public.citas
        WHERE id = $1
        FOR UPDATE
      `,
      [citaId]
    );

    if (cita.rowCount === 0) {
      throw fallo("La cita no existe.", 404);
    }

    const existente = await cliente.query(
      `
        SELECT
          id,
          (
            cita_id = $2
            AND monto = $3::numeric
            AND metodo_pago = $4
            AND referencia IS NOT DISTINCT FROM $5::text
            AND notas IS NOT DISTINCT FROM $6::text
          ) AS coincide
        FROM public.pagos
        WHERE clave_operacion = $1::uuid
      `,
      [clave, citaId, monto, metodo, referencia, notas]
    );

    if (existente.rowCount > 0) {
      if (!existente.rows[0].coincide) {
        throw fallo(
          "La clave de operación corresponde a un pago con otros datos.",
          409
        );
      }

      await cliente.query("COMMIT");
      transaccion = false;

      return res.json({
        correcto: true,
        mensaje: "El pago ya estaba registrado. No se duplicó.",
        pago_id: existente.rows[0].id
      });
    }

    if (cita.rows[0].estado !== "completada") {
      throw fallo("Solo se pueden cobrar consultas completadas.", 409);
    }

    // Se consulta después de adquirir el bloqueo para ver el saldo actualizado.
    const comprobacion = await cliente.query(
      `
        SELECT
          (
            c.importe_total -
            COALESCE(
              (
                SELECT SUM(p.monto)
                FROM public.pagos p
                WHERE p.cita_id = c.id
                  AND p.estado = 'pagado'
              ),
              0
            )
          ) >= $2::numeric AS permitido
        FROM public.citas c
        WHERE c.id = $1
      `,
      [citaId, monto]
    );

    if (!comprobacion.rows[0].permitido) {
      throw fallo(
        "El monto supera el saldo pendiente. Actualiza la cuenta.",
        409
      );
    }

    const pago = await cliente.query(
      `
        INSERT INTO public.pagos (
          cita_id,
          monto,
          metodo_pago,
          estado,
          fecha_pago,
          referencia,
          notas,
          clave_operacion,
          recibido_por
        )
        VALUES (
          $1, $2, $3, 'pagado', CURRENT_TIMESTAMP,
          $4, $5, $6::uuid, $7
        )
        RETURNING id
      `,
      [
        citaId,
        monto,
        metodo,
        referencia,
        notas,
        clave,
        req.usuario.id
      ]
    );

    await auditar(cliente,req.usuario.id,"registrar_pago","pago",pago.rows[0].id,{cita_id:citaId,monto});
    await cliente.query("COMMIT");
    transaccion = false;

    res.status(201).json({
      correcto: true,
      mensaje: "Pago registrado correctamente.",
      pago_id: pago.rows[0].id
    });
  } catch (error) {
    if (transaccion && cliente) {
      await cliente.query("ROLLBACK");
    }

    manejarError(error, res, next);
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

export default router;