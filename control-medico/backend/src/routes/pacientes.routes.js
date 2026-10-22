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
      mensaje: "Tu cuenta no tiene permiso para gestionar pacientes."
    });
  }

  next();
});

function errorValidacion(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  return error;
}

function leerTexto(valor, etiqueta, maximo, obligatorio = false) {
  if (valor === undefined || valor === null || valor === "") {
    if (obligatorio) {
      throw errorValidacion(`${etiqueta} es obligatorio.`);
    }

    return null;
  }

  if (typeof valor !== "string") {
    throw errorValidacion(`${etiqueta} debe ser un texto.`);
  }

  const texto = valor.trim();

  if (obligatorio && !texto) {
    throw errorValidacion(`${etiqueta} es obligatorio.`);
  }

  if (texto.length > maximo) {
    throw errorValidacion(
      `${etiqueta} no puede superar ${maximo} caracteres.`
    );
  }

  return texto || null;
}

function validarFechaNacimiento(valor) {
  if (
    typeof valor !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(valor)
  ) {
    throw errorValidacion("Selecciona una fecha de nacimiento válida.");
  }

  const fecha = new Date(`${valor}T00:00:00.000Z`);

  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.toISOString().slice(0, 10) !== valor ||
    valor < "1900-01-01"
  ) {
    throw errorValidacion(
      "La fecha de nacimiento debe ser válida y posterior a 1899."
    );
  }

  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/El_Salvador",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const componente = (tipo) =>
    partes.find((parte) => parte.type === tipo).value;

  const hoy =
    `${componente("year")}-${componente("month")}-${componente("day")}`;

  if (valor > hoy) {
    throw errorValidacion(
      "La fecha de nacimiento no puede estar en el futuro."
    );
  }

  return valor;
}

router.get("/", async (req, res, next) => {
  try {
    const buscar = leerTexto(
      req.query.buscar ?? "",
      "La búsqueda",
      150
    ) || "";

    const paginaTexto = String(req.query.pagina ?? "1");

    if (!/^[1-9]\d*$/.test(paginaTexto)) {
      throw errorValidacion("La página solicitada no es válida.");
    }

    const pagina = Number(paginaTexto);

    if (!Number.isSafeInteger(pagina) || pagina > 1000000) {
      throw errorValidacion("La página solicitada no es válida.");
    }

    const limite = 10;
    const desplazamiento = (pagina - 1) * limite;

    const conteo = await pool.query(
      `
        SELECT COUNT(*)::integer AS total
        FROM public.pacientes
        WHERE strpos(lower(nombre), lower($1)) > 0
      `,
      [buscar]
    );

    const resultado = await pool.query(
      `
        SELECT
          p.id,
          p.nombre,
          p.telefono,
          p.email,
          p.estado,
          (
            SELECT MAX(c.fecha_hora)
            FROM public.citas c
            WHERE c.paciente_id = p.id
              AND c.estado = 'completada'
              AND c.fecha_hora <= CURRENT_TIMESTAMP
          ) AS ultima_visita
        FROM public.pacientes p
        WHERE strpos(lower(p.nombre), lower($1)) > 0
        ORDER BY p.id DESC
        LIMIT $2 OFFSET $3
      `,
      [buscar, limite, desplazamiento]
    );

    const total = conteo.rows[0].total;

    res.json({
      correcto: true,
      pacientes: resultado.rows,
      total,
      pagina,
      total_paginas: Math.max(1, Math.ceil(total / limite))
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        correcto: false,
        mensaje: error.message
      });
    }

    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const cuerpo = req.body ?? {};

    const nombre = leerTexto(
      cuerpo.nombre,
      "El nombre",
      150,
      true
    );

    const fechaNacimiento = validarFechaNacimiento(
      cuerpo.fecha_nacimiento
    );

    const telefono = leerTexto(
      cuerpo.telefono,
      "El teléfono",
      25
    );

    const email = leerTexto(
      cuerpo.email,
      "El correo",
      254
    );

    const direccion = leerTexto(
      cuerpo.direccion,
      "La dirección",
      500
    );

    const antecedentes = leerTexto(
      cuerpo.antecedentes,
      "Los antecedentes",
      5000
    );

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw errorValidacion("El correo no tiene un formato válido.");
    }

    if (telefono && !/^[0-9+()\s.-]{7,25}$/.test(telefono)) {
      throw errorValidacion("Revisa el formato del teléfono.");
    }

    const resultado = await pool.query(
      `
        INSERT INTO public.pacientes (
          nombre,
          fecha_nacimiento,
          telefono,
          email,
          direccion,
          antecedentes,
          estado
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'activo')
        RETURNING id, nombre, estado
      `,
      [
        nombre,
        fechaNacimiento,
        telefono,
        email ? email.toLowerCase() : null,
        direccion,
        antecedentes
      ]
    );

    res.status(201).json({
      correcto: true,
      mensaje: "Paciente registrado correctamente.",
      paciente: resultado.rows[0]
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        correcto: false,
        mensaje: error.message
      });
    }

    next(error);
  }
});

export default router;