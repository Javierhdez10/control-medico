import bcrypt from "bcrypt";
import { input, password, checkbox, confirm } from "@inquirer/prompts";
import { pool } from "../config/db.js";

function validarTexto(valor, maximo) {
  const texto = valor.trim();

  if (!texto || texto.length > maximo) {
    return `Escribe un valor de entre 1 y ${maximo} caracteres.`;
  }

  return true;
}

function validarHora(valor) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(valor)
    ? true
    : "Usa el formato de 24 horas, por ejemplo 08:00.";
}

async function crearDoctor() {
  let cliente;
  let transaccion = false;

  try {
    const nombre = (
      await input({
        message: "Nombre completo del doctor:",
        validate: (valor) => validarTexto(valor, 150)
      })
    ).trim();

    const email = (
      await input({
        message: "Correo para iniciar sesión:",
        validate: (valor) => {
          const correo = valor.trim();

          return (
            correo.length <= 254 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)
          )
            ? true
            : "Escribe un correo válido.";
        }
      })
    ).trim().toLowerCase();

    const especialidad = (
      await input({
        message: "Especialidad:",
        default: "Medicina general",
        validate: (valor) => validarTexto(valor, 120)
      })
    ).trim();

    const licencia = (
      await input({
        message: "Número de licencia profesional:",
        validate: (valor) => validarTexto(valor, 60)
      })
    ).trim();

    const clave = await password({
      message: "Contraseña de la cuenta del doctor:",
      mask: "*",
      validate: (valor) => {
        if (valor.length < 12) {
          return "Utiliza al menos 12 caracteres.";
        }

        if (Buffer.byteLength(valor, "utf8") > 72) {
          return "La contraseña supera los 72 bytes permitidos.";
        }

        return true;
      }
    });

    await password({
      message: "Repite la contraseña:",
      mask: "*",
      validate: (valor) =>
        valor === clave ? true : "Las contraseñas no coinciden."
    });

    const dias = await checkbox({
      message: "Días de atención: marca con Espacio y confirma con Enter.",
      choices: [
        { name: "Lunes", value: 1, checked: true },
        { name: "Martes", value: 2, checked: true },
        { name: "Miércoles", value: 3, checked: true },
        { name: "Jueves", value: 4, checked: true },
        { name: "Viernes", value: 5, checked: true },
        { name: "Sábado", value: 6 },
        { name: "Domingo", value: 7 }
      ],
      validate: (valores) =>
        valores.length > 0 ? true : "Selecciona al menos un día."
    });

    const horaInicio = await input({
      message: "Hora de inicio, en hora de El Salvador:",
      default: "08:00",
      validate: validarHora
    });

    const horaFin = await input({
      message: "Hora de finalización:",
      default: "17:00",
      validate: (valor) => {
        const validacion = validarHora(valor);

        if (validacion !== true) {
          return validacion;
        }

        return valor > horaInicio
          ? true
          : "La hora final debe ser posterior a la inicial.";
      }
    });

    console.table([{
      nombre,
      email,
      especialidad,
      licencia,
      dias: dias.join(", "),
      horario: `${horaInicio} a ${horaFin}`
    }]);

    const continuar = await confirm({
      message: "¿Crear este doctor y su horario?",
      default: true
    });

    if (!continuar) {
      console.log("Operación cancelada. No se guardaron datos.");
      return;
    }

    const hash = await bcrypt.hash(clave, 12);

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccion = true;

    const usuario = await cliente.query(
      `
        INSERT INTO public.usuarios (
          nombre, email, password_hash, rol, activo
        )
        VALUES ($1, $2, $3, 'doctor', TRUE)
        RETURNING id
      `,
      [nombre, email, hash]
    );

    const doctor = await cliente.query(
      `
        INSERT INTO public.doctores (
          usuario_id, especialidad, licencia, activo
        )
        VALUES ($1, $2, $3, TRUE)
        RETURNING id
      `,
      [usuario.rows[0].id, especialidad, licencia]
    );

    for (const dia of dias) {
      await cliente.query(
        `
          INSERT INTO public.horarios_doctores (
            doctor_id, dia_semana, hora_inicio, hora_fin
          )
          VALUES ($1, $2, $3, $4)
        `,
        [doctor.rows[0].id, dia, horaInicio, horaFin]
      );
    }

    await cliente.query("COMMIT");
    transaccion = false;

    console.log("Doctor, cuenta y horarios registrados correctamente.");
    console.table([{
      doctor_id: doctor.rows[0].id,
      nombre,
      email,
      especialidad
    }]);
  } catch (error) {
    if (transaccion && cliente) {
      await cliente.query("ROLLBACK");
    }

    process.exitCode = 1;

    if (error.name === "ExitPromptError") {
      console.log("Operación cancelada.");
    } else if (error.code === "23505") {
      console.error(
        "Ya existe el correo o la licencia. No se creó un registro parcial."
      );
    } else {
      console.error(
        "No se pudo crear el doctor:",
        error.code ?? error.message
      );
    }
  } finally {
    if (cliente) {
      cliente.release();
    }

    await pool.end();
  }
}

crearDoctor();