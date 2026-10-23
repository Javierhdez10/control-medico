import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();

const zonaHoraria = "America/El_Salvador";

function fechaValida(valor) {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    return false;
  }

  const [anio, mes, dia] = valor.split("-").map(Number);

  if (anio < 1900 || anio > 2100) {
    return false;
  }

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.usuario.rol !== "doctor") {
    return res.status(403).json({
      correcto: false,
      mensaje: "Esta agenda está disponible únicamente para doctores."
    });
  }

  next();
});

router.get("/", async (req, res, next) => {
  const fecha = req.query.fecha;

  if (!fechaValida(fecha)) {
    return res.status(400).json({
      correcto: false,
      mensaje: "Selecciona una fecha válida entre los años 1900 y 2100."
    });
  }

  try {
    const perfil = await pool.query(
      `
        SELECT
          d.id,
          d.especialidad,
          u.nombre
        FROM public.doctores d
        INNER JOIN public.usuarios u
          ON u.id = d.usuario_id
        WHERE d.usuario_id = $1
          AND d.activo = true
          AND u.activo = true
          AND u.rol = 'doctor'
      `,
      [req.usuario.id]
    );

    if (perfil.rowCount === 0) {
      return res.status(403).json({
        correcto: false,
        mensaje:
          "Tu cuenta no tiene un perfil de doctor activo. Consulta con el administrador."
      });
    }

    const doctor = perfil.rows[0];

    const resultado = await pool.query(
      `
        WITH citas_del_dia AS (
          SELECT
            c.id,
            c.paciente_id,
            p.nombre AS paciente,
            c.fecha_hora,
            c.fecha_hora_fin,
            c.motivo,
            c.estado,
            (
              c.estado = 'confirmada'
              AND c.fecha_hora <= CURRENT_TIMESTAMP
            ) AS puede_atender
          FROM public.citas c
          INNER JOIN public.pacientes p
            ON p.id = c.paciente_id
          WHERE c.doctor_id = $1
            AND c.fecha_hora >= (
              $2::date::timestamp AT TIME ZONE $3
            )
            AND c.fecha_hora < (
              ($2::date + 1)::timestamp AT TIME ZONE $3
            )
        ),
        primeras_citas AS (
          SELECT *
          FROM citas_del_dia
          ORDER BY fecha_hora, id
          LIMIT 100
        )
        SELECT
          CURRENT_TIMESTAMP AS actualizado_en,

          (
            SELECT COUNT(*)::integer
            FROM citas_del_dia
          ) AS total,

          (
            SELECT COUNT(*)::integer
            FROM citas_del_dia
            WHERE estado = 'pendiente'
          ) AS pendientes,

          (
            SELECT COUNT(*)::integer
            FROM citas_del_dia
            WHERE estado = 'confirmada'
          ) AS confirmadas,

          (
            SELECT COUNT(*)::integer
            FROM citas_del_dia
            WHERE estado = 'completada'
          ) AS completadas,

          (
            SELECT COUNT(*)::integer
            FROM citas_del_dia
            WHERE estado = 'cancelada'
          ) AS canceladas,

          COALESCE(
            (
              SELECT jsonb_agg(
                to_jsonb(c)
                ORDER BY c.fecha_hora, c.id
              )
              FROM primeras_citas c
            ),
            '[]'::jsonb
          ) AS citas
      `,
      [doctor.id, fecha, zonaHoraria]
    );

    return res.json({
      correcto: true,
      doctor: {
        nombre: doctor.nombre,
        especialidad: doctor.especialidad
      },
      fecha,
      ...resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

export default router;