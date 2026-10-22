import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["admin", "doctor"].includes(req.usuario.rol)) {
    return res.status(403).json({
      correcto: false,
      mensaje: "Tu cuenta no tiene acceso al historial clínico."
    });
  }

  next();
});

function crearError(mensaje, status = 400) {
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
    throw crearError("El identificador no es válido.");
  }

  return numero;
}

function leerTexto(valor, nombre, obligatorio = false) {
  if (valor === undefined || valor === null) {
    valor = "";
  }

  if (typeof valor !== "string") {
    throw crearError(`${nombre} debe ser un texto.`);
  }

  const texto = valor.trim();

  if (obligatorio && !texto) {
    throw crearError(`${nombre} es obligatorio.`);
  }

  if (texto.length > 5000) {
    throw crearError(`${nombre} no puede superar 5000 caracteres.`);
  }

  return texto || null;
}

function responderError(error, res, next) {
  if (error.code === "23505") {
    return res.status(409).json({
      correcto: false,
      mensaje: "Esta cita ya tiene un registro clínico."
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

// El administrador puede consultar todos los pacientes.
// El doctor solo pacientes con citas confirmadas o completadas asignadas.
const condicionAccesoPaciente = `
  (
    $2::boolean = TRUE
    OR EXISTS (
      SELECT 1
      FROM public.citas ca
      JOIN public.doctores da ON da.id = ca.doctor_id
      WHERE ca.paciente_id = p.id
        AND da.usuario_id = $3
        AND da.activo = TRUE
        AND ca.estado IN ('confirmada', 'completada')
    )
  )
`;

router.get("/tratamientos", async (req, res, next) => {
  try {
    const resultado = await pool.query(`
      SELECT id, nombre
      FROM public.tratamientos
      WHERE activo = TRUE
      ORDER BY nombre
    `);

    res.json({
      correcto: true,
      tratamientos: resultado.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pacientes", async (req, res, next) => {
  try {
    const buscar = req.query.buscar ?? "";

    if (typeof buscar !== "string" || buscar.length > 150) {
      throw crearError("La búsqueda no es válida.");
    }

    const pagina = leerId(req.query.pagina ?? 1);

    if (pagina > 1000000) {
      throw crearError("La página solicitada no es válida.");
    }

    const parametros = [
      buscar.trim(),
      req.usuario.rol === "admin",
      req.usuario.id
    ];

    const conteo = await pool.query(
      `
        SELECT COUNT(*)::integer AS total
        FROM public.pacientes p
        WHERE strpos(lower(p.nombre), lower($1)) > 0
          AND ${condicionAccesoPaciente}
      `,
      parametros
    );

    const resultado = await pool.query(
      `
        SELECT p.id, p.nombre, p.telefono, p.estado
        FROM public.pacientes p
        WHERE strpos(lower(p.nombre), lower($1)) > 0
          AND ${condicionAccesoPaciente}
        ORDER BY p.nombre, p.id
        LIMIT 10 OFFSET $4
      `,
      [...parametros, (pagina - 1) * 10]
    );

    res.json({
      correcto: true,
      pacientes: resultado.rows,
      total: conteo.rows[0].total,
      total_paginas: Math.max(
        1,
        Math.ceil(conteo.rows[0].total / 10)
      )
    });
  } catch (error) {
    responderError(error, res, next);
  }
});

router.get("/pacientes/:id", async (req, res, next) => {
  try {
    const pacienteId = leerId(req.params.id);
    const esAdmin = req.usuario.rol === "admin";

    const paciente = await pool.query(
      `
        SELECT
          p.id,
          p.nombre,
          to_char(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
          p.telefono,
          p.email,
          p.alergias,
          p.antecedentes,
          p.estado
        FROM public.pacientes p
        WHERE p.id = $1
          AND ${condicionAccesoPaciente}
      `,
      [pacienteId, esAdmin, req.usuario.id]
    );

    if (paciente.rowCount === 0) {
      throw crearError(
        "El paciente no está disponible para esta cuenta.",
        404
      );
    }

    const historial = await pool.query(
      `
        SELECT
          h.id,
          h.cita_id,
          h.fecha,
          h.diagnostico,
          h.indicaciones,
          h.notas,
          t.nombre AS tratamiento,
          u.nombre AS doctor,
          c.fecha_hora AS fecha_cita
        FROM public.historial_clinico h
        JOIN public.citas c ON c.id = h.cita_id
        JOIN public.doctores d ON d.id = c.doctor_id
        JOIN public.usuarios u ON u.id = d.usuario_id
        LEFT JOIN public.tratamientos t ON t.id = h.tratamiento_id
        WHERE c.paciente_id = $1
        ORDER BY h.fecha DESC, h.id DESC
      `,
      [pacienteId]
    );

    const citas = await pool.query(
      `
        SELECT
          c.id,
          c.fecha_hora,
          c.motivo,
          u.nombre AS doctor,
          c.fecha_hora <= CURRENT_TIMESTAMP AS puede_atender
        FROM public.citas c
        JOIN public.doctores d ON d.id = c.doctor_id
        JOIN public.usuarios u ON u.id = d.usuario_id
        WHERE c.paciente_id = $1
          AND c.estado = 'confirmada'
          AND (
            $2::boolean = TRUE
            OR (
              d.usuario_id = $3
              AND d.activo = TRUE
            )
          )
        ORDER BY c.fecha_hora, c.id
      `,
      [pacienteId, esAdmin, req.usuario.id]
    );

    res.json({
      correcto: true,
      paciente: paciente.rows[0],
      historial: historial.rows,
      citas: citas.rows
    });
  } catch (error) {
    responderError(error, res, next);
  }
});

router.post("/atenciones", async (req, res, next) => {
  let cliente;
  let transaccion = false;

  try {
    if (req.usuario.rol !== "doctor") {
      throw crearError(
        "Solo el doctor asignado puede registrar la atención.",
        403
      );
    }

    const cuerpo = req.body ?? {};
    const citaId = leerId(cuerpo.cita_id);
    const tratamientoId = leerId(cuerpo.tratamiento_id);

    const diagnostico = leerTexto(
      cuerpo.diagnostico,
      "El diagnóstico",
      true
    );

    const indicaciones = leerTexto(
      cuerpo.indicaciones,
      "Las indicaciones",
      true
    );

    const notas = leerTexto(cuerpo.notas, "Las notas");

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccion = true;

    const cita = await cliente.query(
      `
        SELECT
          c.id,
          c.estado,
          c.fecha_hora <= CURRENT_TIMESTAMP AS puede_atender
        FROM public.citas c
        JOIN public.doctores d ON d.id = c.doctor_id
        WHERE c.id = $1
          AND d.usuario_id = $2
          AND d.activo = TRUE
        FOR UPDATE OF c
      `,
      [citaId, req.usuario.id]
    );

    if (cita.rowCount === 0) {
      throw crearError(
        "La cita no está asignada a este doctor.",
        403
      );
    }

    if (cita.rows[0].estado !== "confirmada") {
      throw crearError(
        "Solo se pueden atender citas confirmadas.",
        409
      );
    }

    if (!cita.rows[0].puede_atender) {
      throw crearError(
        "Todavía no ha llegado la hora programada de esta cita.",
        409
      );
    }

    const tratamiento = await cliente.query(
      `
        SELECT id
        FROM public.tratamientos
        WHERE id = $1 AND activo = TRUE
      `,
      [tratamientoId]
    );

    if (tratamiento.rowCount === 0) {
      throw crearError("Selecciona un tratamiento activo.");
    }

    const registro = await cliente.query(
      `
        INSERT INTO public.historial_clinico (
          cita_id,
          tratamiento_id,
          diagnostico,
          indicaciones,
          notas
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [citaId, tratamientoId, diagnostico, indicaciones, notas]
    );

    await cliente.query(
      `
        UPDATE public.citas
        SET estado = 'completada'
        WHERE id = $1
      `,
      [citaId]
    );

    await cliente.query("COMMIT");
    transaccion = false;

    res.status(201).json({
      correcto: true,
      mensaje: "Atención registrada y cita completada.",
      historial_id: registro.rows[0].id
    });
  } catch (error) {
    if (transaccion && cliente) {
      await cliente.query("ROLLBACK");
    }

    responderError(error, res, next);
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

export default router;