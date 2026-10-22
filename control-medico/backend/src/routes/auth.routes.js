import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { pool } from "../config/db.js";

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
        SELECT id, nombre, email, password_hash, rol, activo
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
      {},
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
        SELECT id, nombre, email, rol
        FROM public.usuarios
        WHERE id = $1 AND activo = TRUE
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(401).json({
        correcto: false,
        mensaje: "La cuenta no está disponible."
      });
    }

    req.usuario = resultado.rows[0];
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

export default router;