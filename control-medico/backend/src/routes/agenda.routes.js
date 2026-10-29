import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

import { fallo, leerId, leerFecha, leerDuracion, leerHora, leerInstanteOriginal, comprobarEstadoReprogramable, comprobarDoctor, comprobarPaciente, obtenerDisponibilidad, bloquearAgenda } from "../services/agenda.js";

import { auditar } from "../services/operaciones.js";

const router = Router();
const zona = "America/El_Salvador";


router.use(requerirAutenticacion);

router.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["admin", "recepcionista", "paciente"].includes(req.usuario.rol)) {
    return res.status(403).json({
      correcto: false,
      mensaje: "Tu cuenta no tiene permiso para gestionar la agenda."
    });
  }

  if (req.usuario.rol === "paciente") {
    try {
      const ficha = await pool.query("SELECT id FROM public.pacientes WHERE usuario_id = $1 AND estado <> 'inactivo'", [req.usuario.id]);
      if (!ficha.rowCount) return res.status(403).json({ correcto: false, mensaje: "Tu cuenta no tiene una ficha activa vinculada. Contacta a recepción." });
      req.pacienteId = ficha.rows[0].id;
    } catch (error) { return next(error); }
  }
  next();
});

router.get("/mis-citas", async (req, res, next) => {
  try {
    if (!req.pacienteId) throw fallo("Esta consulta es exclusiva para pacientes.", 403);
    const pagina = leerId(req.query.pagina ?? "1", "La página");
    if (pagina > 1000000) throw fallo("La página no es válida.");
    const grupo = req.query.grupo ?? "todas";
    if (!["proximas","anteriores","todas"].includes(grupo)) throw fallo("Filtro de citas inválido.");
    const condicion = grupo === "proximas" ? "AND c.estado IN ('pendiente','confirmada') AND c.fecha_hora_fin > clock_timestamp()" : grupo === "anteriores" ? "AND (c.estado IN ('completada','cancelada') OR c.fecha_hora_fin <= clock_timestamp())" : "";
    const orden = grupo === "proximas" ? "ASC" : "DESC";
    const resultado = await pool.query(
      `SELECT c.id, c.doctor_id, u.nombre AS doctor, c.fecha_hora, c.fecha_hora_fin,
       c.motivo, c.estado, c.motivo_cancelacion, c.importe_total, c.importe_pendiente,
       (EXTRACT(EPOCH FROM (c.fecha_hora_fin - c.fecha_hora))/60)::integer AS duracion
       FROM public.citas c JOIN public.doctores d ON d.id = c.doctor_id
       JOIN public.usuarios u ON u.id = d.usuario_id WHERE c.paciente_id = $1 ${condicion}
       ORDER BY c.fecha_hora ${orden}, c.id ${orden} LIMIT 20 OFFSET $2`, [req.pacienteId, (pagina - 1) * 20]
    );
    const total = await pool.query(`SELECT count(*)::integer AS total FROM public.citas c WHERE paciente_id = $1 ${condicion}`, [req.pacienteId]);
    res.json({ correcto: true, citas: resultado.rows, total_paginas: Math.max(1, Math.ceil(total.rows[0].total / 20)) });
  } catch (error) { next(error); }
});

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

    const pacienteId = req.pacienteId ?? (req.query.paciente_id
      ? leerId(req.query.paciente_id, "El paciente")
      : null);

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
    if (req.pacienteId) throw fallo("Utiliza la consulta de tus propias citas.", 403);
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
          c.importe_total,
          c.importe_pendiente
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
  let cliente;
  try {
    const cuerpo = req.body ?? {};
    const doctorId = leerId(cuerpo.doctor_id, "El doctor");
    const pacienteId = req.pacienteId ?? leerId(cuerpo.paciente_id, "El paciente");
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

    const importeTexto = req.pacienteId ? "0" : String(cuerpo.importe_total ?? "0");

    if (!/^\d{1,8}(\.\d{1,2})?$/.test(importeTexto)) {
      throw fallo(
        "El importe debe ser positivo o cero, con máximo dos decimales."
      );
    }

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    await bloquearAgenda(cliente, doctorId, pacienteId);
    await comprobarDoctor(doctorId, cliente);
    await comprobarPaciente(pacienteId, cliente);

    const horarios = await obtenerDisponibilidad(
      doctorId,
      fecha,
      duracion,
      pacienteId, null, cliente
    );

    const elegido = horarios.find((item) => item.hora === hora);

    if (!elegido) {
      throw fallo(
        "El horario ya no está disponible o está fuera del horario de atención.",
        409
      );
    }

    const resultado = await cliente.query(
      `
        INSERT INTO public.citas (
          paciente_id,
          doctor_id,
          fecha_hora,
          fecha_hora_fin,
          motivo,
          estado,
          importe_total,
          importe_pendiente
        )
        SELECT $1, $2, $3::timestamptz, $4::timestamptz,
               $5, 'pendiente', $6::numeric, $7
        WHERE $3::timestamptz > clock_timestamp()
        RETURNING id, fecha_hora, fecha_hora_fin, estado
      `,
      [
        pacienteId,
        doctorId,
        elegido.inicio,
        elegido.fin,
        cuerpo.motivo.trim(),
        importeTexto,
        Boolean(req.pacienteId)
      ]
    );

    if (resultado.rowCount === 0) {
      throw fallo(
        "La hora seleccionada ya pasó. Selecciona otro horario.",
        409
      );
    }

    await auditar(cliente,req.usuario.id,"crear_cita","cita",resultado.rows[0].id);
    await cliente.query("COMMIT");
    res.status(201).json({
      correcto: true,
      mensaje: "Cita registrada correctamente.",
      cita: resultado.rows[0]
    });
  } catch (error) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    if (cliente) cliente.release();
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

    if (req.pacienteId && cita.paciente_id !== req.pacienteId) throw fallo("La cita no existe.", 404);

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

    const referencia = await cliente.query("SELECT doctor_id, paciente_id FROM public.citas WHERE id = $1", [id]);
    if (!referencia.rowCount) throw fallo("La cita no existe.", 404);
    if (req.pacienteId && referencia.rows[0].paciente_id !== req.pacienteId) throw fallo("La cita no existe.", 404);
    await bloquearAgenda(cliente, referencia.rows[0].doctor_id, referencia.rows[0].paciente_id);

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

    await auditar(cliente,req.usuario.id,"reprogramar_cita","cita",id);
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
  let cliente;
  try {
    const id = leerId(req.params.id, "La cita");
    const estado = req.body?.estado;
    if (req.pacienteId && estado !== "cancelada") throw fallo("Solo recepción puede confirmar tu cita.", 403);
    const importe = req.body?.importe_total;
    if (importe !== undefined && (req.pacienteId || !/^\d{1,8}(\.\d{1,2})?$/.test(String(importe)))) {
      throw fallo("El importe debe ser positivo o cero, con máximo dos decimales.");
    }

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

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    const resultado = await cliente.query(
      `
        UPDATE public.citas
        SET estado = $2,
            motivo_cancelacion = $3,
            importe_total = CASE WHEN $2 = 'confirmada' AND importe_pendiente THEN $5::numeric ELSE importe_total END,
            importe_pendiente = CASE WHEN $2 = 'confirmada' THEN FALSE ELSE importe_pendiente END
        WHERE id = $1
          AND estado = ANY($4::text[])
          AND ($6::integer IS NULL OR paciente_id = $6)
          AND ($2 <> 'confirmada' OR NOT importe_pendiente OR $5::numeric IS NOT NULL)
        RETURNING id, estado
      `,
      [id, estado, motivoCancelacion, estadosPermitidos, importe ?? null, req.pacienteId ?? null]
    );

    if (resultado.rowCount === 0) {
      throw fallo(
        "La cita no existe, cambió de estado o requiere indicar el importe para confirmarla.",
        409
      );
    }

    await auditar(cliente,req.usuario.id,estado === "cancelada" ? "cancelar_cita" : "confirmar_cita","cita",id);
    await cliente.query("COMMIT");
    res.json({
      correcto: true,
      mensaje: "Estado de la cita actualizado.",
      cita: resultado.rows[0]
    });
  } catch (error) {
    if(cliente) await cliente.query("ROLLBACK").catch(() => {});
    next(error);
  } finally { if(cliente) cliente.release(); }
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
