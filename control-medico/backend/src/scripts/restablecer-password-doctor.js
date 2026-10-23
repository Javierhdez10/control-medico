import bcrypt from "bcrypt";
import { input, password, confirm } from "@inquirer/prompts";
import { pool } from "../config/db.js";

async function restablecerPasswordDoctor() {
  try {
    const conexion = await pool.query(`
      SELECT current_database() AS nombre
    `);

    if (conexion.rows[0].nombre !== "control_medico") {
      throw new Error(
        "Debes conectarte a la base de datos control_medico."
      );
    }

    const correo = (
      await input({
        message: "Correo del doctor:",
        validate: (valor) => {
          const email = valor.trim();

          return (
            (
              email.length <= 254 &&
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            ) ||
            "Escribe un correo válido."
          );
        }
      })
    ).trim().toLowerCase();

    const resultado = await pool.query(
      `
        SELECT
          u.id,
          u.nombre,
          u.email,
          u.activo AS usuario_activo,
          d.activo AS doctor_activo
        FROM public.usuarios u
        INNER JOIN public.doctores d
          ON d.usuario_id = u.id
        WHERE lower(u.email) = $1
          AND u.rol = 'doctor'
      `,
      [correo]
    );

    if (resultado.rowCount === 0) {
      console.log("No se encontró un doctor con ese correo.");
      return;
    }

    const doctor = resultado.rows[0];

    console.table([doctor]);

    if (!doctor.usuario_activo || !doctor.doctor_activo) {
      console.log(
        "La cuenta o el perfil del doctor está inactivo. Este programa no modifica su estado."
      );
      return;
    }

    const nuevaPassword = await password({
      message: "Nueva contraseña:",
      mask: "*",
      validate: (valor) => {
        if (valor.trim().length < 12) {
          return "Utiliza al menos 12 caracteres sin contar espacios al inicio o al final.";
        }

        if (Buffer.byteLength(valor, "utf8") > 72) {
          return "La contraseña supera el límite de 72 bytes. Usa una más corta.";
        }

        return true;
      }
    });

    await password({
      message: "Repite la nueva contraseña:",
      mask: "*",
      validate: (valor) =>
        valor === nuevaPassword || "Las contraseñas no coinciden."
    });

    const continuar = await confirm({
      message: `¿Cambiar la contraseña de ${doctor.nombre}?`,
      default: false
    });

    if (!continuar) {
      console.log("Operación cancelada. No se realizaron cambios.");
      return;
    }

    const hash = await bcrypt.hash(nuevaPassword, 12);

    const actualizado = await pool.query(
      `
        UPDATE public.usuarios u
        SET password_hash = $1
        WHERE u.id = $2
          AND u.rol = 'doctor'
          AND u.activo = true
          AND EXISTS (
            SELECT 1
            FROM public.doctores d
            WHERE d.usuario_id = u.id
              AND d.activo = true
          )
        RETURNING u.email
      `,
      [hash, doctor.id]
    );

    if (actualizado.rowCount === 0) {
      console.log(
        "La cuenta cambió o fue desactivada durante el proceso. No se actualizó la contraseña."
      );
      return;
    }

    console.log("Contraseña actualizada correctamente.");
    console.log(
      `Inicia sesión con el correo: ${actualizado.rows[0].email}`
    );
    console.log("Utiliza la nueva contraseña que acabas de escribir.");
  } catch (error) {
    if (
      error.name === "ExitPromptError" ||
      error.name === "AbortPromptError"
    ) {
      console.log("Operación cancelada.");
      return;
    }

    process.exitCode = 1;

    console.error(
      "No se pudo restablecer la contraseña:",
      error.code ?? error.message
    );
  } finally {
    await pool.end();
  }
}

await restablecerPasswordDoctor();