import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["admin", "recepcionista"].includes(req.usuario.rol)) {
    return res.status(403).json({
      correcto: false,
      mensaje: "No tienes permiso para consultar el Dashboard."
    });
  }

  next();
});

router.get("/", async (req, res, next) => {
  try {
    const resultado = await pool.query(
      `
        WITH calendario AS (
          SELECT
            CURRENT_TIMESTAMP AS actualizado_en,
            (
              CURRENT_TIMESTAMP AT TIME ZONE $1
            )::date AS fecha_local
        ),
        limites AS (
          SELECT
            actualizado_en,
            fecha_local,
            fecha_local::timestamp
              AT TIME ZONE $1 AS inicio_dia,
            (fecha_local + 1)::timestamp
              AT TIME ZONE $1 AS fin_dia,
            date_trunc(
              'month',
              fecha_local::timestamp
            ) AT TIME ZONE $1 AS inicio_mes,
            (
              date_trunc(
                'month',
                fecha_local::timestamp
              ) + INTERVAL '1 month'
            ) AT TIME ZONE $1 AS fin_mes
          FROM calendario
        ),
        citas_del_dia AS (
          SELECT
            c.id,
            c.fecha_hora,
            c.estado,
            p.nombre AS paciente,
            u.nombre AS doctor,
            d.especialidad
          FROM public.citas c
          INNER JOIN public.pacientes p
            ON p.id = c.paciente_id
          INNER JOIN public.doctores d
            ON d.id = c.doctor_id
          INNER JOIN public.usuarios u
            ON u.id = d.usuario_id
          CROSS JOIN limites l
          WHERE c.fecha_hora >= l.inicio_dia
            AND c.fecha_hora < l.fin_dia
        ),
        primeras_citas AS (
          SELECT *
          FROM citas_del_dia
          ORDER BY fecha_hora, id
          LIMIT 20
        )
        SELECT
          to_char(l.fecha_local, 'YYYY-MM-DD') AS fecha_local,
          l.actualizado_en,

          (
            SELECT COUNT(*)
            FROM public.pacientes
          )::integer AS pacientes_registrados,

          (
            SELECT COUNT(*)
            FROM citas_del_dia
            WHERE estado <> 'cancelada'
          )::integer AS citas_hoy,

          (
            SELECT COUNT(*)
            FROM citas_del_dia
            WHERE estado = 'completada'
          )::integer AS consultas_completadas_hoy,

          (
            SELECT COALESCE(SUM(p.monto), 0)::text
            FROM public.pagos p
            WHERE p.estado = 'pagado'
              AND p.fecha_pago >= l.inicio_mes
              AND p.fecha_pago < l.fin_mes
          ) AS ingresos_mes,

          (
            SELECT COUNT(*)
            FROM citas_del_dia
          )::integer AS total_agenda_hoy,

          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'fecha_hora', c.fecha_hora,
                  'estado', c.estado,
                  'paciente', c.paciente,
                  'doctor', c.doctor,
                  'especialidad', c.especialidad
                )
                ORDER BY c.fecha_hora, c.id
              )
              FROM primeras_citas c
            ),
            '[]'::jsonb
          ) AS agenda_hoy

        FROM limites l
      `,
      ["America/El_Salvador"]
    );

    return res.json({
      correcto: true,
      dashboard: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

export default router;