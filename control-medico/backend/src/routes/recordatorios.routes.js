import { Router } from "express";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";
const router=Router();
router.use(requerirAutenticacion);
router.get("/",async(req,res,next)=>{
  res.setHeader("Cache-Control","no-store");
  if(!["admin","recepcionista"].includes(req.usuario.rol))return res.status(403).json({correcto:false,mensaje:"No tienes permiso para consultar recordatorios."});
  try{
    const resultado=await pool.query(`SELECT r.id,r.cita_id,r.inicio_cita,r.estado,r.intentos,r.error_codigo,r.actualizado_en
      FROM public.recordatorios r ORDER BY r.actualizado_en DESC LIMIT 100`);
    res.json({correcto:true,activo:process.env.RECORDATORIOS_ACTIVOS==="true",recordatorios:resultado.rows});
  }catch(error){next(error);}
});
export default router;
