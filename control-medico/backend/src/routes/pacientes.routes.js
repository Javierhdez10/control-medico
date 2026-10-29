import { auditar } from "../services/operaciones.js";
import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();

const estadosPermitidos = [
  "activo",
  "tratamiento",
  "inactivo"
];

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

function leerId(valor) {
  if (
    typeof valor !== "string" ||
    !/^[1-9]\d*$/.test(valor)
  ) {
    throw errorValidacion("El identificador del paciente no es válido.");
  }

  const id = Number(valor);

  if (!Number.isInteger(id) || id > 2147483647) {
    throw errorValidacion("El identificador del paciente no es válido.");
  }

  return id;
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
    throw errorValidacion(
      "Selecciona una fecha de nacimiento válida."
    );
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

function validarPaciente(cuerpo, esEdicion = false) {
  if (
    !cuerpo ||
    typeof cuerpo !== "object" ||
    Array.isArray(cuerpo)
  ) {
    throw errorValidacion("Los datos del paciente no son válidos.");
  }

  if (esEdicion) {
    const camposRequeridos = [
      "nombre",
      "fecha_nacimiento",
      "telefono",
      "email",
      "direccion",
      "antecedentes",
      "estado"
    ];

    for (const campo of camposRequeridos) {
      if (!Object.prototype.hasOwnProperty.call(cuerpo, campo)) {
        throw errorValidacion(
          "La actualización está incompleta. Recarga el formulario del paciente."
        );
      }
    }
  }

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

  let estado = "activo";

  if (esEdicion) {
    if (!estadosPermitidos.includes(cuerpo.estado)) {
      throw errorValidacion("Selecciona un estado válido.");
    }

    estado = cuerpo.estado;
  }

  return {
    nombre,
    fechaNacimiento,
    telefono,
    email: email ? email.toLowerCase() : null,
    direccion,
    antecedentes,
    estado
  };
}

router.get("/", async (req, res, next) => {
  try {
    const buscar =
      leerTexto(req.query.buscar ?? "", "La búsqueda", 150) || "";

    const paginaTexto = req.query.pagina ?? "1";

    if (
      typeof paginaTexto !== "string" ||
      !/^[1-9]\d*$/.test(paginaTexto)
    ) {
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
          (p.usuario_id IS NOT NULL) AS tiene_cuenta,
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

    return res.json({
      correcto: true,
      pacientes: resultado.rows,
      total,
      pagina,
      total_paginas: Math.max(1, Math.ceil(total / limite))
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = leerId(req.params.id);

    const resultado = await pool.query(
      `
        SELECT
          id,
          nombre,
          to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
          telefono,
          email,
          direccion,
          antecedentes,
          estado
        FROM public.pacientes
        WHERE id = $1
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        correcto: false,
        mensaje: "El paciente solicitado no existe."
      });
    }

    return res.json({
      correcto: true,
      paciente: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const datos = validarPaciente(req.body);

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
        datos.nombre,
        datos.fechaNacimiento,
        datos.telefono,
        datos.email,
        datos.direccion,
        datos.antecedentes
      ]
    );

    return res.status(201).json({
      correcto: true,
      mensaje: "Paciente registrado correctamente.",
      paciente: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/cuenta", async (req, res, next) => {
  let cliente;
  let transaccion = false;
  try {
    const id = leerId(req.params.id);
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || email.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== "string" || password.trim().length < 12 ||
        Buffer.byteLength(password, "utf8") > 72) {
      throw errorValidacion("Introduce un correo válido y una contraseña de al menos 12 caracteres y máximo 72 bytes.");
    }
    const hash = await bcrypt.hash(password, 12);
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccion = true;
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    const ficha = await cliente.query(
      "SELECT id, nombre, telefono, usuario_id, estado FROM public.pacientes WHERE id = $1 FOR UPDATE", [id]
    );
    if (!ficha.rowCount) {
      return res.status(404).json({ correcto: false, mensaje: "El paciente no existe." });
    }
    const paciente = ficha.rows[0];
    if (paciente.usuario_id || paciente.estado === "inactivo") {
      return res.status(409).json({ correcto: false, mensaje: "El paciente ya tiene una cuenta vinculada o está inactivo." });
    }
    const usuario = await cliente.query(
      `INSERT INTO public.usuarios (nombre, email, password_hash, rol, telefono)
       VALUES ($1, $2, $3, 'paciente', $4) RETURNING id`,
      [paciente.nombre, email.trim().toLowerCase(), hash, paciente.telefono]
    );
    await cliente.query("UPDATE public.pacientes SET usuario_id = $1 WHERE id = $2", [usuario.rows[0].id, id]);
    await auditar(cliente, req.usuario.id, "crear_acceso_paciente", "paciente", id);
    await cliente.query("COMMIT");
    transaccion = false;
    res.status(201).json({ correcto: true, mensaje: "Cuenta creada y vinculada a la ficha del paciente." });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ correcto: false, mensaje: "Ese correo ya pertenece a otra cuenta. No se modificó la ficha." });
    }
    if (["55P03", "40P01", "57014"].includes(error.code)) {
      return res.status(409).json({ correcto: false, mensaje: "La ficha está siendo modificada. Actualiza y vuelve a intentarlo." });
    }
    next(error);
  } finally {
    if (cliente) {
      try { if (transaccion) await cliente.query("ROLLBACK"); cliente.release(); }
      catch { cliente.release(true); }
    }
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = leerId(req.params.id);
    const datos = validarPaciente(req.body, true);

    const resultado = await pool.query(
      `
        UPDATE public.pacientes
        SET
          nombre = $1,
          fecha_nacimiento = $2,
          telefono = $3,
          email = $4,
          direccion = $5,
          antecedentes = $6,
          estado = $7
        WHERE id = $8
        RETURNING id, nombre, estado
      `,
      [
        datos.nombre,
        datos.fechaNacimiento,
        datos.telefono,
        datos.email,
        datos.direccion,
        datos.antecedentes,
        datos.estado,
        id
      ]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        correcto: false,
        mensaje: "El paciente que intentas actualizar no existe."
      });
    }

    return res.json({
      correcto: true,
      mensaje: "Paciente actualizado correctamente.",
      paciente: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (error.status === 400) {
    return res.status(400).json({
      correcto: false,
      mensaje: error.message
    });
  }

  next(error);
});

export default router;
