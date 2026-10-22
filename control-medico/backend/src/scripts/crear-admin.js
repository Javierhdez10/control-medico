import bcrypt from "bcrypt";
import { input, password } from "@inquirer/prompts";
import { pool } from "../config/db.js";

async function crearAdministrador() {
  try {
    const conexion = await pool.query(
      "SELECT current_database() AS nombre"
    );

    if (conexion.rows[0].nombre !== "control_medico") {
      throw new Error(
        "La conexión debe apuntar a la base control_medico."
      );
    }

    console.log("Configuración de administrador de Control Médico.");
    console.log("La contraseña no se mostrará en pantalla.");

    const nombreIngresado = await input({
      message: "Nombre completo:",
      validate: (valor) => {
        const nombre = valor.trim();

        if (nombre.length < 2 || nombre.length > 150) {
          return "Escribe un nombre de entre 2 y 150 caracteres.";
        }

        return true;
      }
    });

    const correoIngresado = await input({
      message: "Correo para iniciar sesión:",
      validate: (valor) => {
        const correo = valor.trim();

        if (
          correo.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
        ) {
          return "Escribe un correo con formato válido.";
        }

        return true;
      }
    });

    const nombre = nombreIngresado.trim();
    const email = correoIngresado.trim().toLowerCase();

    const existente = await pool.query(
      `
        SELECT id
        FROM public.usuarios
        WHERE lower(email) = $1
      `,
      [email]
    );

    if (existente.rowCount > 0) {
      console.log(
        "Ese correo ya está registrado. No se modificó ninguna cuenta."
      );

      return;
    }

    const clave = await password({
      message: "Contraseña de la cuenta (mínimo 12 caracteres):",
      mask: "*",
      validate: (valor) => {
        if (valor.length < 12) {
          return "La contraseña debe tener al menos 12 caracteres.";
        }

        if (Buffer.byteLength(valor, "utf8") > 72) {
          return "La contraseña supera el límite de 72 bytes de bcrypt.";
        }

        return true;
      }
    });

    await password({
      message: "Repite la contraseña:",
      mask: "*",
      validate: (valor) => {
        if (valor !== clave) {
          return "Las contraseñas no coinciden. Inténtalo de nuevo.";
        }

        return true;
      }
    });

    const passwordHash = await bcrypt.hash(clave, 12);

    const resultado = await pool.query(
      `
        INSERT INTO public.usuarios (
          nombre,
          email,
          password_hash,
          rol,
          activo
        )
        VALUES ($1, $2, $3, 'admin', TRUE)
        RETURNING id, nombre, email, rol, activo
      `,
      [nombre, email, passwordHash]
    );

    console.log("\nAdministrador creado correctamente.");
    console.table(resultado.rows);
    console.log(
      "Guarda tu correo y contraseña: los usarás para iniciar sesión."
    );
  } catch (error) {
    process.exitCode = 1;

    if (error.name === "ExitPromptError") {
      console.log("\nOperación cancelada.");
    } else if (error.code === "23505") {
      console.error(
        "Ese correo ya fue registrado. No se modificó la cuenta existente."
      );
    } else if (error.code === "42P01") {
      console.error(
        "No existe la tabla usuarios. Comprueba que ejecutaste el archivo 01_crear_tablas.sql en control_medico."
      );
    } else if (error.code === "28P01") {
      console.error(
        "PostgreSQL rechazó las credenciales. Revisa DB_USER y DB_PASSWORD en backend/.env."
      );
    } else if (error.code === "ECONNREFUSED") {
      console.error(
        "No se pudo contactar con PostgreSQL. Revisa su servicio, DB_HOST y DB_PORT."
      );
    } else {
      console.error(
        "No se pudo completar la creación del administrador:",
        error.code ?? error.message
      );
    }
  } finally {
    await pool.end();
  }
}

crearAdministrador();