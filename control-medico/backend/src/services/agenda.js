import { pool } from "../config/db.js";
const zona = "America/El_Salvador";
const duraciones = [15, 30, 45, 60];

// Orden común para reservas, reprogramaciones y cambios de horario.
export async function bloquearAgenda(cliente, doctorId, pacienteId = null) {
  await cliente.query("SET LOCAL lock_timeout = '3s'");
  await cliente.query("SET LOCAL statement_timeout = '4s'");
  await cliente.query("SELECT id FROM public.doctores WHERE id = $1 FOR UPDATE", [doctorId]);
  if (pacienteId !== null) {
    await cliente.query("SELECT id FROM public.pacientes WHERE id = $1 FOR UPDATE", [pacienteId]);
  }
}

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

export { fallo, leerId, leerFecha, leerDuracion, leerHora, leerInstanteOriginal, comprobarEstadoReprogramable, comprobarDoctor, comprobarPaciente, obtenerDisponibilidad };
