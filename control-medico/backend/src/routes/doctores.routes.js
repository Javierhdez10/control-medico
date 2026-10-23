import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../config/db.js";
import { requerirAutenticacion } from "./auth.routes.js";

const router = Router();

router.use(requerirAutenticacion);

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.usuario.rol !== "admin") {
    return res.status(403).json({
      correcto: false,
      mensaje: "Solo el administrador puede gestionar doctores."
    });
  }

  next();
});

function errorValidacion(mensaje) {
  const error = new Error(mensaje);
  error.status = 400;
  return error;
}

function errorHttp(mensaje, status) {
  const error = new Error(mensaje);
  error.status = status;
  return error;
}

function leerId(valor) {
  if (
    typeof valor !== "string" ||
    !/^[1-9]\d*$/.test(valor)
  ) {
    throw errorValidacion("El identificador del doctor no es válido.");
  }

  const id = Number(valor);

  if (!Number.isInteger(id) || id > 2147483647) {
    throw errorValidacion("El identificador del doctor no es válido.");
  }

  return id;
}

function leerTexto(valor, etiqueta, maximo, obligatorio = true) {
  if (valor === undefined || valor === null || valor === "") {
    if (obligatorio) {
      throw errorValidacion(`${etiqueta} es obligatorio.`);
    }

    return null;
  }

  if (typeof valor !== "string") {
    throw errorValidacion(`${etiqueta} debe ser texto.`);
  }

  const texto = valor.trim();

  if (obligatorio && texto.length === 0) {
    throw errorValidacion(`${etiqueta} es obligatorio.`);
  }

  if (texto.length > maximo) {
    throw errorValidacion(
      `${etiqueta} no puede superar ${maximo} caracteres.`
    );
  }

  return texto || null;
}

function leerHora(valor, etiqueta) {
  if (
    typeof valor !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)
  ) {
    throw errorValidacion(`${etiqueta} debe tener el formato HH:mm.`);
  }

  return valor;
}

function validarDatosBasicos(cuerpo) {
  if (
    !cuerpo ||
    typeof cuerpo !== "object" ||
    Array.isArray(cuerpo)
  ) {
    throw errorValidacion("Los datos del doctor no son válidos.");
  }

  const nombre = leerTexto(cuerpo.nombre, "El nombre", 150);

  const email = leerTexto(
    cuerpo.email,
    "El correo",
    254
  ).toLowerCase();

  const telefono = leerTexto(
    cuerpo.telefono,
    "El teléfono",
    25,
    false
  );

  const especialidad = leerTexto(
    cuerpo.especialidad,
    "La especialidad",
    120
  );

  const licencia = leerTexto(
    cuerpo.licencia,
    "La licencia profesional",
    60
  );

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw errorValidacion("El correo no tiene un formato válido.");
  }

  if (telefono && !/^[0-9+()\s.-]{7,25}$/.test(telefono)) {
    throw errorValidacion("Revisa el formato del teléfono.");
  }

  return {
    nombre,
    email,
    telefono,
    especialidad,
    licencia
  };
}

function validarCreacion(cuerpo) {
  const datos = validarDatosBasicos(cuerpo);

  if (
    typeof cuerpo.password !== "string" ||
    cuerpo.password.trim().length < 12 ||
    Buffer.byteLength(cuerpo.password, "utf8") > 72
  ) {
    throw errorValidacion(
      "La contraseña debe tener al menos 12 caracteres sin contar espacios al inicio o al final y no superar 72 bytes."
    );
  }

  if (
    !Array.isArray(cuerpo.dias) ||
    cuerpo.dias.length < 1 ||
    cuerpo.dias.length > 7
  ) {
    throw errorValidacion(
      "Selecciona entre uno y siete días de atención."
    );
  }

  if (
    cuerpo.dias.some(
      (dia) => !Number.isInteger(dia) || dia < 1 || dia > 7
    )
  ) {
    throw errorValidacion(
      "Los días deben ser números del 1 al 7: lunes a domingo."
    );
  }

  if (new Set(cuerpo.dias).size !== cuerpo.dias.length) {
    throw errorValidacion("No repitas los días de atención.");
  }

  const horaInicio = leerHora(
    cuerpo.hora_inicio,
    "La hora de inicio"
  );

  const horaFin = leerHora(
    cuerpo.hora_fin,
    "La hora de finalización"
  );

  if (horaFin <= horaInicio) {
    throw errorValidacion(
      "La hora de finalización debe ser posterior a la hora de inicio."
    );
  }

  return {
    ...datos,
    password: cuerpo.password,
    dias: [...cuerpo.dias].sort((a, b) => a - b),
    horaInicio,
    horaFin
  };
}

async function comprobarDuplicados(
  conexion,
  datos,
  usuarioId = null,
  doctorId = null
) {
  const correoExistente = await conexion.query(
    `
      SELECT id
      FROM public.usuarios
      WHERE lower(email) = $1
        AND ($2::integer IS NULL OR id <> $2)
      LIMIT 1
    `,
    [datos.email, usuarioId]
  );

  if (correoExistente.rowCount > 0) {
    throw errorHttp("Ese correo ya pertenece a otra cuenta.", 409);
  }

  const licenciaExistente = await conexion.query(
    `
      SELECT id
      FROM public.doctores
      WHERE licencia = $1
        AND ($2::integer IS NULL OR id <> $2)
      LIMIT 1
    `,
    [datos.licencia, doctorId]
  );

  if (licenciaExistente.rowCount > 0) {
    throw errorHttp(
      "Esa licencia profesional ya pertenece a otro doctor.",
      409
    );
  }
}

router.get("/", async (req, res, next) => {
  try {
    const buscar =
      leerTexto(req.query.buscar ?? "", "La búsqueda", 150, false) || "";

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
        FROM public.doctores d
        INNER JOIN public.usuarios u ON u.id = d.usuario_id
        WHERE strpos(lower(u.nombre), lower($1)) > 0
           OR strpos(lower(u.email), lower($1)) > 0
           OR strpos(lower(d.especialidad), lower($1)) > 0
      `,
      [buscar]
    );

    const resultado = await pool.query(
      `
        SELECT
          d.id,
          u.id AS usuario_id,
          u.nombre,
          u.email,
          u.telefono,
          u.activo AS usuario_activo,
          d.especialidad,
          d.licencia,
          d.activo AS doctor_activo,
          (
            d.activo
            AND u.activo
            AND u.rol = 'doctor'
          ) AS disponible,
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'dia_semana', h.dia_semana,
                  'hora_inicio', to_char(h.hora_inicio, 'HH24:MI'),
                  'hora_fin', to_char(h.hora_fin, 'HH24:MI')
                )
                ORDER BY h.dia_semana, h.hora_inicio
              )
              FROM public.horarios_doctores h
              WHERE h.doctor_id = d.id
            ),
            '[]'::jsonb
          ) AS horarios
        FROM public.doctores d
        INNER JOIN public.usuarios u ON u.id = d.usuario_id
        WHERE strpos(lower(u.nombre), lower($1)) > 0
           OR strpos(lower(u.email), lower($1)) > 0
           OR strpos(lower(d.especialidad), lower($1)) > 0
        ORDER BY u.nombre, d.id
        LIMIT $2 OFFSET $3
      `,
      [buscar, limite, desplazamiento]
    );

    const total = conteo.rows[0].total;

    return res.json({
      correcto: true,
      doctores: resultado.rows,
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
          d.id,
          u.nombre,
          u.email,
          u.telefono,
          d.especialidad,
          d.licencia
        FROM public.doctores d
        INNER JOIN public.usuarios u ON u.id = d.usuario_id
        WHERE d.id = $1
          AND u.rol = 'doctor'
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      throw errorHttp(
        "El doctor no existe o su cuenta ya no tiene el rol de doctor.",
        404
      );
    }

    return res.json({
      correcto: true,
      doctor: resultado.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  let cliente;

  try {
    const datos = validarCreacion(req.body);

    await comprobarDuplicados(pool, datos);

    const passwordHash = await bcrypt.hash(datos.password, 12);

    cliente = await pool.connect();

    await cliente.query("BEGIN");
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    await cliente.query("SET LOCAL statement_timeout = '4s'");

    const usuarioResultado = await cliente.query(
      `
        INSERT INTO public.usuarios (
          nombre,
          email,
          password_hash,
          rol,
          telefono,
          activo
        )
        VALUES ($1, $2, $3, 'doctor', $4, true)
        RETURNING id
      `,
      [
        datos.nombre,
        datos.email,
        passwordHash,
        datos.telefono
      ]
    );

    const usuarioId = usuarioResultado.rows[0].id;

    const doctorResultado = await cliente.query(
      `
        INSERT INTO public.doctores (
          usuario_id,
          especialidad,
          licencia,
          activo
        )
        VALUES ($1, $2, $3, true)
        RETURNING id
      `,
      [usuarioId, datos.especialidad, datos.licencia]
    );

    const doctorId = doctorResultado.rows[0].id;

    for (const dia of datos.dias) {
      await cliente.query(
        `
          INSERT INTO public.horarios_doctores (
            doctor_id,
            dia_semana,
            hora_inicio,
            hora_fin
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          doctorId,
          dia,
          datos.horaInicio,
          datos.horaFin
        ]
      );
    }

    await cliente.query("COMMIT");

    return res.status(201).json({
      correcto: true,
      mensaje: "Doctor y horarios registrados correctamente.",
      doctor: {
        id: doctorId,
        usuario_id: usuarioId,
        nombre: datos.nombre,
        email: datos.email,
        especialidad: datos.especialidad,
        licencia: datos.licencia,
        horarios: datos.dias.map((dia) => ({
          dia_semana: dia,
          hora_inicio: datos.horaInicio,
          hora_fin: datos.horaFin
        }))
      }
    });
  } catch (error) {
    if (cliente) {
      try {
        await cliente.query("ROLLBACK");
      } catch {
        cliente.release(true);
        cliente = null;
      }
    }

    next(error);
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

router.put("/:id", async (req, res, next) => {
  let cliente;

  try {
    const id = leerId(req.params.id);

    const campos = [
      "nombre",
      "email",
      "telefono",
      "especialidad",
      "licencia"
    ];

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      campos.some(
        (campo) =>
          !Object.prototype.hasOwnProperty.call(req.body, campo)
      )
    ) {
      throw errorValidacion(
        "La actualización está incompleta. Abre nuevamente el formulario."
      );
    }

    const datos = validarDatosBasicos(req.body);

    cliente = await pool.connect();

    await cliente.query("BEGIN");
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    await cliente.query("SET LOCAL statement_timeout = '4s'");

    const existente = await cliente.query(
      `
        SELECT
          d.id,
          d.usuario_id
        FROM public.doctores d
        INNER JOIN public.usuarios u ON u.id = d.usuario_id
        WHERE d.id = $1
          AND u.rol = 'doctor'
        FOR UPDATE OF d, u
      `,
      [id]
    );

    if (existente.rowCount === 0) {
      throw errorHttp(
        "El doctor no existe o su cuenta ya no tiene el rol de doctor.",
        404
      );
    }

    const usuarioId = existente.rows[0].usuario_id;

    await comprobarDuplicados(
      cliente,
      datos,
      usuarioId,
      id
    );

    await cliente.query(
      `
        UPDATE public.usuarios
        SET
          nombre = $1,
          email = $2,
          telefono = $3
        WHERE id = $4
      `,
      [
        datos.nombre,
        datos.email,
        datos.telefono,
        usuarioId
      ]
    );

    await cliente.query(
      `
        UPDATE public.doctores
        SET
          especialidad = $1,
          licencia = $2
        WHERE id = $3
      `,
      [
        datos.especialidad,
        datos.licencia,
        id
      ]
    );

    await cliente.query("COMMIT");

    return res.json({
      correcto: true,
      mensaje: "Datos del doctor actualizados correctamente.",
      doctor: {
        id,
        nombre: datos.nombre,
        email: datos.email,
        telefono: datos.telefono,
        especialidad: datos.especialidad,
        licencia: datos.licencia
      }
    });
  } catch (error) {
    if (cliente) {
      try {
        await cliente.query("ROLLBACK");
      } catch {
        cliente.release(true);
        cliente = null;
      }
    }

    next(error);
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

router.use((error, req, res, next) => {
  if ([400, 404, 409].includes(error.status)) {
    return res.status(error.status).json({
      correcto: false,
      mensaje: error.message
    });
  }

  if (error.code === "23505") {
    return res.status(409).json({
      correcto: false,
      mensaje:
        "El correo o la licencia ya están registrados. No se guardaron los cambios."
    });
  }

  if (["40P01", "55P03", "57014"].includes(error.code)) {
    return res.status(409).json({
      correcto: false,
      mensaje:
        "No se pudo completar la operación en este momento. Actualiza el listado y revisa los datos antes de intentarlo nuevamente."
    });
  }

  next(error);
});

export default router;