import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";
import { leerId } from "../services/agenda.js";
import { errorHttp, responderError } from "../services/operaciones.js";
const router = Router();
router.use(requerirAutenticacion);
router.get("/",async(req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  if(req.usuario.rol!=="admin") return res.status(403).json({correcto:false,mensaje:"Solo el administrador puede consultar el registro de cambios."});
  try {
    const pagina=leerId(req.query.pagina??"1","La página");
    if(pagina>1000000) throw errorHttp("Página inválida.");
    const resultado=await pool.query(`SELECT a.id,a.fecha,a.accion,a.entidad,a.entidad_id,a.detalles,u.nombre AS responsable
      FROM public.auditoria a LEFT JOIN public.usuarios u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT 30 OFFSET $1`,[(pagina-1)*30]);
    const total=await pool.query("SELECT count(*)::integer AS total FROM public.auditoria");
    res.json({correcto:true,eventos:resultado.rows,total_paginas:Math.max(1,Math.ceil(total.rows[0].total/30))});
  } catch(error) { next(error); }
});
router.use(responderError);
export default router;
