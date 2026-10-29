import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/db.js";

import { transaccion, auditar, validarPassword, errorHttp, responderError } from "../services/operaciones.js";

const router = Router();

const secreto = process.env.JWT_SECRET;

if (!secreto || !/^[a-f0-9]{96}$/i.test(secreto)) {
  throw new Error(
    "JWT_SECRET debe contener la cadena hexadecimal de 96 caracteres generada para este proyecto."
  );
}

const emisor = "control-medico-api";
const audiencia = "control-medico-web";

// Permite realizar una comparación bcrypt aunque el correo no exista.
const hashAlternativo = await bcrypt.hash(
  randomBytes(32).toString("hex"),
  12
);

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    correcto: false,
    mensaje: "Demasiados intentos. Inténtalo nuevamente en 15 minutos."
  }
});

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/login", limiteLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        correcto: false,
        mensaje: "Debes enviar correo y contraseña."
      });
    }

    const correo = email.trim().toLowerCase();

    if (
      correo.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ||
      password.length === 0 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        correcto: false,
        mensaje: "Revisa el formato del correo y la contraseña."
      });
    }

    const resultado = await pool.query(
      `
        SELECT id, nombre, email, password_hash, rol, activo, version_sesion
        FROM public.usuarios
        WHERE lower(email) = $1
      `,
      [correo]
    );

    const usuario = resultado.rows[0];

    const coincide = await bcrypt.compare(
      password,
      usuario?.password_hash ?? hashAlternativo
    );

    if (!usuario || !coincide || !usuario.activo) {
      return res.status(401).json({
        correcto: false,
        mensaje: "Correo o contraseña incorrectos."
      });
    }

    const token = jwt.sign(
      { version: usuario.version_sesion },
      secreto,
      {
        algorithm: "HS256",
        subject: String(usuario.id),
        issuer: emisor,
        audience: audiencia,
        expiresIn: "1h"
      }
    );

    return res.json({
      correcto: true,
      mensaje: "Inicio de sesión correcto.",
      token,
      tipo_token: "Bearer",
      expira_en_segundos: 3600,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol
      }
    });
  } catch (error) {
    next(error);
  }
});

export async function requerirAutenticacion(req, res, next) {
  const autorizacion = req.get("Authorization") ?? "";
  const coincidencia = /^Bearer ([^\s]+)$/i.exec(autorizacion);

  if (!coincidencia) {
    return res.status(401).json({
      correcto: false,
      mensaje: "Debes iniciar sesión para continuar."
    });
  }

  let contenido;

  try {
    contenido = jwt.verify(coincidencia[1], secreto, {
      algorithms: ["HS256"],
      issuer: emisor,
      audience: audiencia
    });
  } catch {
    return res.status(401).json({
      correcto: false,
      mensaje: "La sesión expiró o el token no es válido."
    });
  }

  const id = Number(contenido.sub);

  if (
    !/^[1-9]\d*$/.test(String(contenido.sub)) ||
    !Number.isSafeInteger(id) ||
    id > 2147483647
  ) {
    return res.status(401).json({
      correcto: false,
      mensaje: "El token no es válido."
    });
  }

  try {
    const resultado = await pool.query(
      `
        SELECT id, nombre, email, rol, version_sesion
        FROM public.usuarios
        WHERE id = $1 AND activo = TRUE
      `,
      [id]
    );

    if (resultado.rowCount === 0 || contenido.version !== resultado.rows[0].version_sesion) {
      return res.status(401).json({
        correcto: false,
        mensaje: "La cuenta no está disponible."
      });
    }

    const { version_sesion, ...usuario } = resultado.rows[0];
    req.usuario = usuario;
    next();
  } catch (error) {
    next(error);
  }
}

router.get("/me", requerirAutenticacion, (req, res) => {
  res.json({
    correcto: true,
    usuario: req.usuario
  });
});

const limitePassword = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false,
  message: { correcto: false, mensaje: "Demasiados intentos. Espera 15 minutos." } });
router.post("/password", limitePassword, requerirAutenticacion, async (req,res,next) => {
  try {
    const nueva = validarPassword(req.body?.nueva);
    if (typeof req.body?.actual !== "string" || Buffer.byteLength(req.body.actual,"utf8") > 72) throw errorHttp("Introduce tu contraseña actual.");
    await transaccion(async cliente => {
      const resultado = await cliente.query("SELECT password_hash FROM public.usuarios WHERE id=$1 AND activo FOR UPDATE",[req.usuario.id]);
      if (!resultado.rowCount || !await bcrypt.compare(req.body.actual,resultado.rows[0].password_hash)) throw errorHttp("La contraseña actual no coincide.",400);
      await cliente.query("UPDATE public.usuarios SET password_hash=$1, version_sesion=version_sesion+1 WHERE id=$2",[await bcrypt.hash(nueva,12),req.usuario.id]);
      await cliente.query("UPDATE public.recuperaciones SET usado_en=clock_timestamp() WHERE usuario_id=$1 AND usado_en IS NULL",[req.usuario.id]);
      await auditar(cliente,req.usuario.id,"cambiar_password","usuario",req.usuario.id);
    });
    res.json({correcto:true,mensaje:"Contraseña actualizada. Inicia sesión nuevamente en tus dispositivos."});
  } catch(error) { next(error); }
});
router.post("/recuperar", limitePassword, async (req,res,next) => {
  try {
    const nueva = validarPassword(req.body?.nueva);
    const codigo = req.body?.codigo;
    if (typeof codigo !== "string" || !/^[a-f0-9]{64}$/i.test(codigo)) throw errorHttp("El código no es válido o ha vencido.");
    const hash = createHash("sha256").update(codigo).digest("hex");
    await transaccion(async cliente => {
      const referencia = await cliente.query("SELECT usuario_id FROM public.recuperaciones WHERE codigo_hash=$1",[hash]);
      if (!referencia.rowCount) throw errorHttp("El código no es válido o ha vencido.");
      const id = referencia.rows[0].usuario_id;
      const usuario = await cliente.query("SELECT id FROM public.usuarios WHERE id=$1 AND activo FOR UPDATE",[id]);
      const resultado = await cliente.query("UPDATE public.recuperaciones SET usado_en=clock_timestamp() WHERE codigo_hash=$1 AND usado_en IS NULL AND vence_en>clock_timestamp() RETURNING id",[hash]);
      if (!usuario.rowCount || !resultado.rowCount) throw errorHttp("El código no es válido o ha vencido.");
      await cliente.query("UPDATE public.usuarios SET password_hash=$1,version_sesion=version_sesion+1 WHERE id=$2",[await bcrypt.hash(nueva,12),id]);
      await cliente.query("UPDATE public.recuperaciones SET usado_en=clock_timestamp() WHERE usuario_id=$1 AND usado_en IS NULL",[id]);
      await auditar(cliente,id,"recuperar_password","usuario",id);
    });
    res.json({correcto:true,mensaje:"Contraseña restablecida. Ya puedes iniciar sesión."});
  } catch(error) { next(error); }
});
router.use(responderError);
export default router;