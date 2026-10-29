import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";
import { leerFecha, leerId, fallo } from "../services/agenda.js";

const router = Router();
router.use(requerirAutenticacion);
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["admin", "recepcionista"].includes(req.usuario.rol)) return res.status(403).json({ correcto: false, mensaje: "No tienes permiso para consultar reportes." });
  next();
});
router.get("/", async (req, res, next) => {
  try {
    const desde = leerFecha(req.query.desde), hasta = leerFecha(req.query.hasta);
    if (desde > hasta) throw fallo("La fecha inicial debe ser anterior o igual a la final.");
    const doctorId = req.query.doctor_id ? leerId(req.query.doctor_id, "El doctor") : null;
    const resultado = await pool.query(
      `WITH ingresos AS (
         SELECT c.doctor_id, SUM(p.monto) AS ingresos, COUNT(*)::integer AS pagos
         FROM public.pagos p JOIN public.citas c ON c.id = p.cita_id
         WHERE p.estado = 'pagado'
           AND p.fecha_pago >= ($1::date::timestamp AT TIME ZONE 'America/El_Salvador')
           AND p.fecha_pago < (($2::date + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
         GROUP BY c.doctor_id
       ), actividad AS (
         SELECT doctor_id, COUNT(*)::integer AS citas,
           COUNT(*) FILTER (WHERE estado = 'completada')::integer AS completadas,
           COUNT(*) FILTER (WHERE estado = 'cancelada')::integer AS canceladas
         FROM public.citas
         WHERE fecha_hora >= ($1::date::timestamp AT TIME ZONE 'America/El_Salvador')
           AND fecha_hora < (($2::date + 1)::timestamp AT TIME ZONE 'America/El_Salvador')
         GROUP BY doctor_id
       )
       SELECT d.id, u.nombre, d.especialidad, COALESCE(i.ingresos,0)::numeric(14,2) AS ingresos,
         COALESCE(i.pagos,0) AS pagos, COALESCE(a.citas,0) AS citas,
         COALESCE(a.completadas,0) AS completadas, COALESCE(a.canceladas,0) AS canceladas
       FROM public.doctores d JOIN public.usuarios u ON u.id = d.usuario_id
       LEFT JOIN ingresos i ON i.doctor_id = d.id LEFT JOIN actividad a ON a.doctor_id = d.id
       WHERE ($3::integer IS NULL OR d.id = $3) ORDER BY u.nombre, d.id`, [desde,hasta,doctorId]
    );
    res.json({ correcto: true, desde, hasta, doctores: resultado.rows });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ correcto: false, mensaje: error.message });
    next(error);
  }
});
export default router;
