import bcrypt from "bcrypt";
import { input, password, confirm } from "@inquirer/prompts";
import { pool } from "../config/db.js";

function validarNombre(valor) {
  const nombre = valor.trim();

  if (nombre.length < 2) {
    return "Escribe un nombre de al menos 2 caracteres.";
  }

  if (nombre.length > 150) {
    return "El nombre no puede superar los 150 caracteres.";
  }

  return true;
}

function validarCorreo(valor) {
  const correo = valor.trim().toLowerCase();

  if (correo.length > 254) {
    return "El correo no puede superar los 254 caracteres.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return "Escribe un correo electrónico válido.";
  }

  return true;
}

function validarTelefono(valor) {
  const telefono = valor.trim();

  if (telefono === "") {
    return true;
  }

  if (
    telefono.length > 25 ||
    !/^[0-9+()\s.-]{7,25}$/.test(telefono)
  ) {
    return "Usa entre 7 y 25 caracteres: números, espacios, +, -, puntos o paréntesis.";
  }

  return true;
}

function validarContrasena(valor) {
  if (valor.trim().length < 12) {
    return "La contraseña debe tener al menos 12 caracteres sin contar espacios al inicio o al final.";
  }

  if (Buffer.byteLength(valor, "utf8") > 72) {
    return "La contraseña supera el límite de 72 bytes. Usa una más corta.";
  }

  return true;
}

async function crearRecepcionista() {
  let contrasena = "";

  try {
    const conexion = await pool.query(`
      SELECT current_database() AS base_de_datos
    `);

    const baseDeDatos = conexion.rows[0].base_de_datos;

    if (baseDeDatos !== "control_medico") {
      throw new Error(
        "El script debe ejecutarse conectado a la base de datos control_medico."
      );
    }

    console.log("");
    console.log("Registro de una cuenta de recepción");
    console.log("----------------------------------");
    console.log("");

    const nombre = (
      await input({
        message: "Nombre completo:",
        validate: validarNombre
      })
    ).trim();

    const email = (
      await input({
        message: "Correo electrónico:",
        validate: validarCorreo
      })
    )
      .trim()
      .toLowerCase();

    const existente = await pool.query(
      `
        SELECT id
        FROM public.usuarios
        WHERE lower(email) = $1
        LIMIT 1
      `,
      [email]
    );

    if (existente.rowCount > 0) {
      console.error("");
      console.error(
        "Ese correo ya pertenece a una cuenta. No se modificó ningún usuario."
      );

      process.exitCode = 1;
      return;
    }

    const telefonoIngresado = (
      await input({
        message: "Teléfono, opcional:",
        validate: validarTelefono
      })
    ).trim();

    const telefono = telefonoIngresado || null;

    contrasena = await password({
      message: "Contraseña de acceso:",
      mask: "*",
      validate: validarContrasena
    });

    await password({
      message: "Repite la contraseña:",
      mask: "*",
      validate: (valor) =>
        valor === contrasena ||
        "Las contraseñas no coinciden. Inténtalo nuevamente."
    });

    console.log("");
    console.log("Datos de la cuenta:");

    console.table([
      {
        nombre,
        email,
        telefono: telefono ?? "Sin teléfono",
        rol: "recepcionista"
      }
    ]);

    const continuar = await confirm({
      message: "¿Crear esta cuenta de recepción?",
      default: false
    });

    if (!continuar) {
      console.log("Operación cancelada. No se creó ninguna cuenta.");
      return;
    }

    const passwordHash = await bcrypt.hash(contrasena, 12);

    contrasena = "";

    const resultado = await pool.query(
      `
        INSERT INTO public.usuarios (
          nombre,
          email,
          password_hash,
          rol,
          telefono,
          activo
        )
        VALUES ($1, $2, $3, 'recepcionista', $4, true)
        RETURNING
          id,
          nombre,
          email,
          rol,
          activo
      `,
      [nombre, email, passwordHash, telefono]
    );

    console.log("");
    console.log("Cuenta de recepción creada correctamente.");

    console.table(resultado.rows);

    console.log(
      "Ya puedes iniciar sesión en la aplicación con el correo y la contraseña registrados."
    );
  } catch (error) {
    if (
      error.name === "ExitPromptError" ||
      error.name === "AbortPromptError"
    ) {
      console.log("");
      console.log("Entrada cancelada por el usuario.");
      return;
    }

    process.exitCode = 1;

    if (error.code === "23505") {
      console.error(
        "El correo ya está registrado. No se creó una cuenta duplicada."
      );
      return;
    }

    if (error.code === "28P01") {
      console.error(
        "PostgreSQL rechazó las credenciales. Revisa DB_USER y DB_PASSWORD en backend/.env."
      );
      return;
    }

    if (error.code === "3D000") {
      console.error(
        "La base de datos configurada no existe. Revisa DB_NAME en backend/.env."
      );
      return;
    }

    if (error.code === "ECONNREFUSED") {
      console.error(
        "No se pudo conectar con PostgreSQL. Comprueba que el servicio esté iniciado y revisa DB_HOST y DB_PORT."
      );
      return;
    }

    if (error.code === "42P01") {
      console.error(
        "No se encontró la tabla usuarios. Comprueba que ejecutaste el script inicial en control_medico."
      );
      return;
    }

    if (error.code) {
      console.error(
        "No se pudo completar el registro. Código:",
        error.code
      );
      return;
    }

    console.error(
      "No se pudo completar el registro:",
      error.message
    );
  } finally {
    contrasena = "";

    try {
      await pool.end();
    } catch {
      console.error(
        "No se pudo cerrar correctamente la conexión con PostgreSQL."
      );

      process.exitCode = 1;
    }
  }
}

await crearRecepcionista();