import { Router } from "express";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";
import { leerId } from "../services/agenda.js";
import { transaccion, auditar, validarPassword, errorHttp, responderError } from "../services/operaciones.js";

const router = Router();
router.use(requerirAutenticacion);
router.use((req,res,next) => {
  res.setHeader("Cache-Control","no-store");
  if (req.usuario.rol !== "admin") return res.status(403).json({correcto:false,mensaje:"Solo el administrador puede gestionar cuentas."});
  next();
});
function datosCuenta(cuerpo) {
  const { nombre, email, telefono = "" } = cuerpo ?? {};
  if (typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 150 ||
      typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof telefono !== "string" || (telefono && !/^[0-9+()\s.-]{7,25}$/.test(telefono))) throw errorHttp("Revisa nombre, correo y teléfono.");
  return { nombre:nombre.trim(), email:email.trim().toLowerCase(), telefono:telefono.trim() || null };
}
router.get("/",async(req,res,next) => {
  try {
    const buscar = req.query.buscar ?? "";
    if (typeof buscar !== "string" || buscar.length > 150) throw errorHttp("Búsqueda inválida.");
    const pagina = leerId(req.query.pagina ?? "1","La página");
    if (pagina > 1000000) throw errorHttp("Página inválida.");
    const resultado = await pool.query(`SELECT id,nombre,email,telefono,rol,activo FROM public.usuarios
      WHERE strpos(lower(nombre),lower($1))>0 OR strpos(lower(email),lower($1))>0
      ORDER BY id DESC LIMIT 20 OFFSET $2`,[buscar,(pagina-1)*20]);
    const total = await pool.query("SELECT count(*)::integer AS total FROM public.usuarios WHERE strpos(lower(nombre),lower($1))>0 OR strpos(lower(email),lower($1))>0",[buscar]);
    res.json({correcto:true,usuarios:resultado.rows,total_paginas:Math.max(1,Math.ceil(total.rows[0].total/20))});
  } catch(error) { next(error); }
});
router.post("/",async(req,res,next) => {
  try {
    const datos = datosCuenta(req.body);
    const hash = await bcrypt.hash(validarPassword(req.body?.password),12);
    const id = await transaccion(async cliente => {
      // Esta pantalla crea recepción; los doctores y pacientes se crean desde su módulo.
      const alta = await cliente.query("INSERT INTO public.usuarios(nombre,email,telefono,password_hash,rol) VALUES($1,$2,$3,$4,'recepcionista') RETURNING id",[datos.nombre,datos.email,datos.telefono,hash]);
      await auditar(cliente,req.usuario.id,"crear_cuenta","usuario",alta.rows[0].id,{rol:"recepcionista"});
      return alta.rows[0].id;
    });
    res.status(201).json({correcto:true,mensaje:"Cuenta de recepción creada.",id});
  } catch(error) { next(error); }
});
router.put("/:id",async(req,res,next) => {
  try {
    const id = leerId(req.params.id,"La cuenta"), datos = datosCuenta(req.body);
    await transaccion(async cliente => {
      const actual = await cliente.query("SELECT id FROM public.usuarios WHERE id=$1 AND rol='recepcionista' FOR UPDATE",[id]);
      if (!actual.rowCount) throw errorHttp("Solo se editan cuentas de recepción desde esta pantalla.",409);
      await cliente.query("UPDATE public.usuarios SET nombre=$1,email=$2,telefono=$3 WHERE id=$4",[datos.nombre,datos.email,datos.telefono,id]);
      await auditar(cliente,req.usuario.id,"editar_cuenta","usuario",id);
    });
    res.json({correcto:true,mensaje:"Datos de recepción actualizados."});
  } catch(error) { next(error); }
});
router.patch("/:id/estado",async(req,res,next) => {
  try {
    const id = leerId(req.params.id,"La cuenta");
    if (typeof req.body?.activo !== "boolean") throw errorHttp("Indica el estado de la cuenta.");
    await transaccion(async cliente => {
      const actual = await cliente.query("SELECT rol FROM public.usuarios WHERE id=$1 FOR UPDATE",[id]);
      if (!actual.rowCount) throw errorHttp("La cuenta no existe.",404);
      if (!["recepcionista","paciente"].includes(actual.rows[0].rol)) throw errorHttp("Gestiona doctores desde su módulo. No se desactivan administradores aquí.",409);
      await cliente.query("UPDATE public.usuarios SET activo=$1,version_sesion=version_sesion+1 WHERE id=$2",[req.body.activo,id]);
      await auditar(cliente,req.usuario.id,req.body.activo ? "activar_cuenta" : "desactivar_cuenta","usuario",id);
    });
    res.json({correcto:true,mensaje:"Estado actualizado. Las sesiones anteriores quedaron cerradas."});
  } catch(error) { next(error); }
});
const limitarRecuperacion = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:"draft-8",legacyHeaders:false,message:{correcto:false,mensaje:"Demasiados intentos. Espera 15 minutos."}});
router.post("/:id/recuperacion",limitarRecuperacion,async(req,res,next) => {
  try {
    const id = leerId(req.params.id,"La cuenta");
    if (typeof req.body?.password_admin !== "string" || Buffer.byteLength(req.body.password_admin,"utf8")>72) throw errorHttp("Confirma tu contraseña de administrador.");
    const admin = await pool.query("SELECT password_hash FROM public.usuarios WHERE id=$1 AND activo AND rol='admin'",[req.usuario.id]);
    if (!admin.rowCount || !await bcrypt.compare(req.body.password_admin,admin.rows[0].password_hash)) throw errorHttp("La contraseña del administrador no coincide.");
    const codigo = randomBytes(32).toString("hex");
    await transaccion(async cliente => {
      const cuenta = await cliente.query("SELECT id FROM public.usuarios WHERE id=$1 AND activo FOR UPDATE",[id]);
      if (!cuenta.rowCount) throw errorHttp("La cuenta no existe o está inactiva.",404);
      await cliente.query("UPDATE public.recuperaciones SET usado_en=clock_timestamp() WHERE usuario_id=$1 AND usado_en IS NULL",[id]);
      await cliente.query("INSERT INTO public.recuperaciones(usuario_id,codigo_hash,vence_en,creado_por) VALUES($1,$2,clock_timestamp()+interval '30 minutes',$3)",[id,createHash("sha256").update(codigo).digest("hex"),req.usuario.id]);
      await auditar(cliente,req.usuario.id,"generar_recuperacion","usuario",id);
    });
    res.json({correcto:true,codigo,mensaje:"Código válido por 30 minutos y un solo uso. Entrégalo privadamente tras verificar la identidad de la persona."});
  } catch(error) { next(error); }
});
router.use(responderError);
export default router;
