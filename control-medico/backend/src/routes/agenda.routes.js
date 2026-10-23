import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();
const zona = "America/El_Salvador";
const duraciones = [15, 30, 45, 60];

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["admin", "recepcionista"].includes(req.usuario.rol)) {
    return res.status(403).json({
      correcto: false,
      mensaje: "Tu cuenta no tiene permiso para gestionar la agenda."
    });
  }

  next();
});

function fallo(mensaje, status = 400) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function leerId(valor, nombre) {
  if (!["string", "number"].includes(typeof valor)) {
    throw fallo(`${nombre} no es válido.`);
  }

  const texto = String(valor);

  if (!/^[1-9]\d*$/.test(texto)) {
    throw fallo(`${nombre} no es válido.`);
  }

  const numero = Number(texto);

  if (!Number.isSafeInteger(numero) || numero > 2147483647) {
    throw fallo(`${nombre} no es válido.`);
  }

  return numero;
}

function leerFecha(valor) {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    throw fallo("La fecha debe tener el formato AAAA-MM-DD.");
  }

  const fecha = new Date(`${valor}T00:00:00.000Z`);

  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.toISOString().slice(0, 10) !== valor ||
    valor < "1900-01-01" ||
    valor > "2100-12-31"
  ) {
    throw fallo("Selecciona una fecha válida.");
  }

  return valor;
}

function leerDuracion(valor) {
  if (!["number", "string"].includes(typeof valor)) {
    throw fallo("Selecciona una duración válida.");
  }

  const duracion = Number(valor);

  if (!duraciones.includes(duracion)) {
    throw fallo("La duración debe ser de 15, 30, 45 o 60 minutos.");
  }

  return duracion;
}

function leerHora(valor) {
  if (
    typeof valor !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)
  ) {
    throw fallo("Selecciona una hora válida.");
  }

  return valor;
}

function leerInstanteOriginal(valor) {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(valor)
  ) {
    throw fallo("Faltan los datos originales. Abre nuevamente la cita.");
  }

  const instante = new Date(valor).getTime();

  if (!Number.isFinite(instante)) {
    throw fallo("Los datos originales de la cita no son válidos.");
  }

  return instante;
}

function comprobarEstadoReprogramable(cita) {
  if (!["pendiente", "confirmada"].includes(cita.estado)) {
    throw fallo(
      "Solo puedes reprogramar citas pendientes o confirmadas.",
      409
    );
  }
}

async function comprobarDoctor(doctorId, conexion = pool) {
  const resultado = await conexion.query(
    `
      SELECT d.id
      FROM public.doctores d
      JOIN public.usuarios u ON u.id = d.usuario_id
      WHERE d.id = $1
        AND d.activo = true
        AND u.activo = true
        AND u.rol = 'doctor'
    `,
    [doctorId]
  );

  if (resultado.rowCount === 0) {
    throw fallo("El doctor no existe o no está activo.", 404);
  }
}

async function comprobarPaciente(pacienteId, conexion = pool) {
  const resultado = await conexion.query(
    `
      SELECT id
      FROM public.pacientes
      WHERE id = $1
        AND estado <> 'inactivo'
    `,
    [pacienteId]
  );

  if (resultado.rowCount === 0) {
    throw fallo("El paciente no existe o está inactivo.", 404);
  }
}

async function obtenerDisponibilidad(
  doctorId,
  fecha,
  duracion,
  pacienteId = null,
  citaExcluidaId = null,
  conexion = pool
) {
  const resultado = await conexion.query(
    `
      WITH horarios AS (
        SELECT
          ($2::date + h.hora_inicio) AT TIME ZONE $5 AS inicio,
          ($2::date + h.hora_fin) AT TIME ZONE $5 AS fin
        FROM public.horarios_doctores h
        WHERE h.doctor_id = $1
          AND h.dia_semana =
              EXTRACT(ISODOW FROM $2::date)::integer
      ),
      bloques AS (
        SELECT DISTINCT
          s.inicio,
          s.inicio + ($3::integer * INTERVAL '1 minute') AS fin
        FROM horarios h
        CROSS JOIN LATERAL generate_series(
          h.inicio,
          h.fin - ($3::integer * INTERVAL '1 minute'),
          INTERVAL '15 minutes'
        ) AS s(inicio)
      )
      SELECT
        b.inicio,
        b.fin,
        to_char(b.inicio AT TIME ZONE $5, 'HH24:MI') AS hora
      FROM bloques b
      WHERE b.inicio > clock_timestamp()
        AND NOT EXISTS (
          SELECT 1
          FROM public.citas c
          WHERE c.estado <> 'cancelada'
            AND ($6::integer IS NULL OR c.id <> $6::integer)
            AND (
              c.doctor_id = $1
              OR (
                $4::integer IS NOT NULL
                AND c.paciente_id = $4::integer
              )
            )
            AND c.fecha_hora < b.fin
            AND c.fecha_hora_fin > b.inicio
        )
      ORDER BY b.inicio
    `,
    [
      doctorId,
      fecha,
      duracion,
      pacienteId,
      zona,
      citaExcluidaId
    ]
  );

  return resultado.rows;
}

router.get("/doctores", async (req, res, next) => {
  try {
    const resultado = await pool.query(`
      SELECT d.id, u.nombre, d.especialidad
      FROM public.doctores d
      JOIN public.usuarios u ON u.id = d.usuario_id
      WHERE d.activo = true
        AND u.activo = true
        AND u.rol = 'doctor'
      ORDER BY u.nombre, d.id
    `);

    res.json({
      correcto: true,
      doctores: resultado.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get("/disponibilidad", async (req, res, next) => {
  try {
    const doctorId = leerId(req.query.doctor_id, "El doctor");
    const fecha = leerFecha(req.query.fecha);
    const duracion = leerDuracion(req.query.duracion ?? 30);

    const pacienteId = req.query.paciente_id
      ? leerId(req.query.paciente_id, "El paciente")
      : null;

    await comprobarDoctor(doctorId);

    if (pacienteId) {
      await comprobarPaciente(pacienteId);
    }

    const horarios = await obtenerDisponibilidad(
      doctorId,
      fecha,
      duracion,
      pacienteId
    );

    res.json({
      correcto: true,
      fecha,
      duracion,
      horarios
    });
  } catch (error) {
    next(error);
  }
});

router.get("/citas", async (req, res, next) => {
  try {
    const doctorId = leerId(req.query.doctor_id, "El doctor");
    const fecha = leerFecha(req.query.fecha);

    const resultado = await pool.query(
      `
        SELECT
          c.id,
          c.paciente_id,
          p.nombre AS paciente,
          c.doctor_id,
          c.fecha_hora,
          c.fecha_hora_fin,
          to_char(
            c.fecha_hora AT TIME ZONE $3,
            'HH24:MI'
          ) AS hora,
          EXTRACT(
            EPOCH FROM (c.fecha_hora_fin - c.fecha_hora)
          )::integer / 60 AS duracion,
          c.motivo,
          c.estado,
          c.motivo_cancelacion,
          c.importe_total
        FROM public.citas c
        JOIN public.pacientes p ON p.id = c.paciente_id
        WHERE c.doctor_id = $1
          AND c.fecha_hora >=
              ($2::date::timestamp AT TIME ZONE $3)
          AND c.fecha_hora <
              (($2::date + 1)::timestamp AT TIME ZONE $3)
        ORDER BY c.fecha_hora, c.id
      `,
      [doctorId, fecha, zona]
    );

    res.json({
      correcto: true,
      citas: resultado.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post("/citas", async (req, res, next) => {
  try {
    const cuerpo = req.body ?? {};
    const doctorId = leerId(cuerpo.doctor_id, "El doctor");
    const pacienteId = leerId(cuerpo.paciente_id, "El paciente");
    const fecha = leerFecha(cuerpo.fecha);
    const duracion = leerDuracion(cuerpo.duracion);
    const hora = leerHora(cuerpo.hora);

    if (
      typeof cuerpo.motivo !== "string" ||
      !cuerpo.motivo.trim() ||
      cuerpo.motivo.trim().length > 2000
    ) {
      throw fallo("El motivo debe tener entre 1 y 2000 caracteres.");
    }

    const importeTexto = String(cuerpo.importe_total ?? "0");

    if (!/^\d{1,8}(\.\d{1,2})?$/.test(importeTexto)) {
      throw fallo(
        "El importe debe ser positivo o cero, con máximo dos decimales."
      );
    }

    await comprobarDoctor(doctorId);
    await comprobarPaciente(pacienteId);

    const horarios = await obtenerDisponibilidad(
      doctorId,
      fecha,
      duracion,
      pacienteId
    );

    const elegido = horarios.find((item) => item.hora === hora);

    if (!elegido) {
      throw fallo(
        "El horario ya no está disponible o está fuera del horario de atención.",
        409
      );
    }

    const resultado = await pool.query(
      `
        INSERT INTO public.citas (
          paciente_id,
          doctor_id,
          fecha_hora,
          fecha_hora_fin,
          motivo,
          estado,
          importe_total
        )
        SELECT $1, $2, $3::timestamptz, $4::timestamptz,
               $5, 'pendiente', $6::numeric
        WHERE $3::timestamptz > clock_timestamp()
        RETURNING id, fecha_hora, fecha_hora_fin, estado
      `,
      [
        pacienteId,
        doctorId,
        elegido.inicio,
        elegido.fin,
        cuerpo.motivo.trim(),
        importeTexto
      ]
    );

    if (resultado.rowCount === 0) {
      throw fallo(
        "La hora seleccionada ya pasó. Selecciona otro horario.",
        409
      );
    }

    res.status(201).json({
      correcto: true,
      mensaje: "Cita registrada correctamente.",
      cita: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.get("/citas/:id/disponibilidad", async (req, res, next) => {
  try {
    const id = leerId(req.params.id, "La cita");
    const fecha = leerFecha(req.query.fecha);
    const duracion = leerDuracion(req.query.duracion);

    const resultado = await pool.query(
      `
        SELECT id, doctor_id, paciente_id, estado
        FROM public.citas
        WHERE id = $1
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      throw fallo("La cita no existe.", 404);
    }

    const cita = resultado.rows[0];

    comprobarEstadoReprogramable(cita);
    await comprobarDoctor(cita.doctor_id);
    await comprobarPaciente(cita.paciente_id);

    const horarios = await obtenerDisponibilidad(
      cita.doctor_id,
      fecha,
      duracion,
      cita.paciente_id,
      cita.id
    );

    res.json({
      correcto: true,
      fecha,
      duracion,
      horarios
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/citas/:id/reprogramar", async (req, res, next) => {
  let cliente;

  try {
    const id = leerId(req.params.id, "La cita");
    const cuerpo = req.body ?? {};
    const fecha = leerFecha(cuerpo.fecha);
    const duracion = leerDuracion(cuerpo.duracion);
    const hora = leerHora(cuerpo.hora);

    const inicioOriginal = leerInstanteOriginal(
      cuerpo.fecha_hora_original
    );

    const finOriginal = leerInstanteOriginal(
      cuerpo.fecha_hora_fin_original
    );

    if (!["pendiente", "confirmada"].includes(cuerpo.estado_original)) {
      throw fallo("Abre nuevamente la cita desde el listado.");
    }

    cliente = await pool.connect();

    await cliente.query("BEGIN");
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    await cliente.query("SET LOCAL statement_timeout = '4s'");

    const resultado = await cliente.query(
      `
        SELECT
          id,
          doctor_id,
          paciente_id,
          fecha_hora,
          fecha_hora_fin,
          estado
        FROM public.citas
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      throw fallo("La cita no existe.", 404);
    }

    const cita = resultado.rows[0];

    comprobarEstadoReprogramable(cita);

    if (
      new Date(cita.fecha_hora).getTime() !== inicioOriginal ||
      new Date(cita.fecha_hora_fin).getTime() !== finOriginal ||
      cita.estado !== cuerpo.estado_original
    ) {
      throw fallo(
        "La cita cambió mientras la editabas. Vuelve al listado, actualiza y abre Reprogramar nuevamente.",
        409
      );
    }

    await comprobarDoctor(cita.doctor_id, cliente);
    await comprobarPaciente(cita.paciente_id, cliente);

    const horarios = await obtenerDisponibilidad(
      cita.doctor_id,
      fecha,
      duracion,
      cita.paciente_id,
      cita.id,
      cliente
    );

    const elegido = horarios.find((item) => item.hora === hora);

    if (!elegido) {
      throw fallo(
        "El nuevo horario ya no está disponible. Selecciona otro horario.",
        409
      );
    }

    const actualizado = await cliente.query(
      `
        UPDATE public.citas
        SET
          fecha_hora = $2,
          fecha_hora_fin = $3
        WHERE id = $1
          AND $2::timestamptz > clock_timestamp()
        RETURNING id, fecha_hora, fecha_hora_fin, estado
      `,
      [id, elegido.inicio, elegido.fin]
    );

    if (actualizado.rowCount === 0) {
      throw fallo(
        "La hora seleccionada ya pasó. Selecciona otro horario.",
        409
      );
    }

    await cliente.query("COMMIT");

    res.json({
      correcto: true,
      mensaje: "Cita reprogramada correctamente.",
      cita: actualizado.rows[0]
    });
  } catch (error) {
    if (cliente) {
      try {
        await cliente.query("ROLLBACK");
      } catch {
        cliente.release(true);
        cliente = null;
      }
    }

    next(error);
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

router.patch("/citas/:id/estado", async (req, res, next) => {
  try {
    const id = leerId(req.params.id, "La cita");
    const estado = req.body?.estado;

    if (!["confirmada", "cancelada"].includes(estado)) {
      throw fallo("El estado debe ser confirmada o cancelada.");
    }

    let motivoCancelacion = null;

    if (estado === "cancelada") {
      const motivo = req.body?.motivo_cancelacion;

      if (
        typeof motivo !== "string" ||
        !motivo.trim() ||
        motivo.trim().length > 1000
      ) {
        throw fallo(
          "Escribe un motivo de cancelación de entre 1 y 1000 caracteres."
        );
      }

      motivoCancelacion = motivo.trim();
    }

    const estadosPermitidos =
      estado === "confirmada"
        ? ["pendiente"]
        : ["pendiente", "confirmada"];

    const resultado = await pool.query(
      `
        UPDATE public.citas
        SET estado = $2,
            motivo_cancelacion = $3
        WHERE id = $1
          AND estado = ANY($4::text[])
        RETURNING id, estado
      `,
      [id, estado, motivoCancelacion, estadosPermitidos]
    );

    if (resultado.rowCount === 0) {
      throw fallo(
        "La cita no existe o su estado actual no permite ese cambio.",
        409
      );
    }

    res.json({
      correcto: true,
      mensaje: "Estado de la cita actualizado.",
      cita: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (error.code === "23P01") {
    return res.status(409).json({
      correcto: false,
      mensaje:
        "Ese horario ya está ocupado para el doctor o el paciente. Actualiza la disponibilidad."
    });
  }

  if (["40P01", "55P03", "57014"].includes(error.code)) {
    return res.status(409).json({
      correcto: false,
      mensaje:
        "No se pudo completar el cambio en este momento. Vuelve al listado, actualiza y revisa la cita antes de intentarlo nuevamente."
    });
  }

  if ([400, 403, 404, 409].includes(error.status)) {
    return res.status(error.status).json({
      correcto: false,
      mensaje: error.message
    });
  }

  next(error);
});

export default router;