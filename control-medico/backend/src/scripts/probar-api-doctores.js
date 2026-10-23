import {
  input,
  password,
  checkbox,
  confirm
} from "@inquirer/prompts";

const baseUrl = "http://127.0.0.1:3000";

async function consultar(ruta, opciones = {}) {
  const {
    token,
    cuerpo,
    method = "GET"
  } = opciones;

  const headers = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (cuerpo !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let respuesta;

  try {
    respuesta = await fetch(`${baseUrl}${ruta}`, {
      method,
      headers,
      body:
        cuerpo === undefined
          ? undefined
          : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError"
    ) {
      throw new Error(
        "La solicitud agotó el tiempo de espera. Si estabas creando un doctor, consulta el listado antes de repetir el registro."
      );
    }

    throw new Error(
      "No se pudo conectar con el backend. Comprueba que esté funcionando en el puerto 3000."
    );
  }

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok || datos?.correcto !== true) {
    throw new Error(
      datos?.mensaje ||
      `La solicitud falló con estado ${respuesta.status}.`
    );
  }

  return datos;
}

function validarTexto(valor) {
  return valor.trim().length > 0 || "Este campo es obligatorio.";
}

function validarHora(valor) {
  return (
    /^([01]\d|2[0-3]):[0-5]\d$/.test(valor) ||
    "Escribe una hora en formato HH:mm, por ejemplo 08:00."
  );
}

async function ejecutar() {
  try {
    console.log("");
    console.log("Comprobación de la API de doctores");
    console.log("");

    const emailAdmin = (
      await input({
        message: "Correo de tu administrador:",
        validate: validarTexto
      })
    ).trim().toLowerCase();

    const passwordAdmin = await password({
      message: "Contraseña del administrador:",
      mask: "*"
    });

    const sesion = await consultar("/api/auth/login", {
      method: "POST",
      cuerpo: {
        email: emailAdmin,
        password: passwordAdmin
      }
    });

    const cuenta = await consultar("/api/auth/me", {
      token: sesion.token
    });

    if (cuenta.usuario.rol !== "admin") {
      throw new Error(
        "La cuenta utilizada no es de administrador."
      );
    }

    console.log("");
    console.log("Autenticación correcta.");

    const listado = await consultar("/api/doctores", {
      token: sesion.token
    });

    console.log(`Doctores registrados: ${listado.total}`);

    console.table(
      listado.doctores.map((doctor) => ({
        id: doctor.id,
        nombre: doctor.nombre,
        correo: doctor.email,
        especialidad: doctor.especialidad,
        disponible: doctor.disponible
      }))
    );

    const crear = await confirm({
      message: "¿Registrar un doctor nuevo para comprobar la API?",
      default: false
    });

    if (!crear) {
      console.log("Consulta completada. No se creó ninguna cuenta.");
      return;
    }

    const nombre = (
      await input({
        message: "Nombre del doctor:",
        validate: validarTexto
      })
    ).trim();

    const email = (
      await input({
        message: "Correo del doctor:",
        validate: validarTexto
      })
    ).trim().toLowerCase();

    const especialidad = (
      await input({
        message: "Especialidad:",
        validate: validarTexto
      })
    ).trim();

    const licencia = (
      await input({
        message: "Licencia profesional:",
        validate: validarTexto
      })
    ).trim();

    const telefono = (
      await input({
        message: "Teléfono, opcional:"
      })
    ).trim();

    const nuevaPassword = await password({
      message: "Contraseña del doctor:",
      mask: "*",
      validate: (valor) => {
        if (valor.trim().length < 12) {
          return "Utiliza al menos 12 caracteres.";
        }

        if (Buffer.byteLength(valor, "utf8") > 72) {
          return "La contraseña supera los 72 bytes.";
        }

        return true;
      }
    });

    await password({
      message: "Repite la contraseña del doctor:",
      mask: "*",
      validate: (valor) =>
        valor === nuevaPassword ||
        "Las contraseñas no coinciden."
    });

    const dias = await checkbox({
      message: "Días de atención:",
      choices: [
        { name: "Lunes", value: 1, checked: true },
        { name: "Martes", value: 2, checked: true },
        { name: "Miércoles", value: 3, checked: true },
        { name: "Jueves", value: 4, checked: true },
        { name: "Viernes", value: 5, checked: true },
        { name: "Sábado", value: 6 },
        { name: "Domingo", value: 7 }
      ],
      validate: (seleccionados) =>
        seleccionados.length > 0 ||
        "Selecciona al menos un día."
    });

    const horaInicio = await input({
      message: "Hora de inicio:",
      default: "08:00",
      validate: validarHora
    });

    const horaFin = await input({
      message: "Hora de finalización:",
      default: "17:00",
      validate: (valor) => {
        const formato = validarHora(valor);

        if (formato !== true) {
          return formato;
        }

        return (
          valor > horaInicio ||
          "La hora final debe ser posterior a la inicial."
        );
      }
    });

    console.log("");
    console.table([
      {
        nombre,
        email,
        especialidad,
        licencia,
        dias: dias.join(", "),
        horario: `${horaInicio} a ${horaFin}`
      }
    ]);

    const confirmar = await confirm({
      message: "¿Guardar este doctor y sus horarios?",
      default: false
    });

    if (!confirmar) {
      console.log("Registro cancelado.");
      return;
    }

    const resultado = await consultar("/api/doctores", {
      method: "POST",
      token: sesion.token,
      cuerpo: {
        nombre,
        email,
        telefono,
        especialidad,
        licencia,
        password: nuevaPassword,
        dias,
        hora_inicio: horaInicio,
        hora_fin: horaFin
      }
    });

    console.log("");
    console.log(resultado.mensaje);

    console.table([
      {
        id: resultado.doctor.id,
        nombre: resultado.doctor.nombre,
        correo: resultado.doctor.email,
        especialidad: resultado.doctor.especialidad
      }
    ]);

    console.log("Horarios registrados:");
    console.table(resultado.doctor.horarios);

    console.log(
      "Ya puedes iniciar sesión con la cuenta del doctor y consultarlo desde la agenda administrativa."
    );
  } catch (error) {
    if (
      error.name === "ExitPromptError" ||
      error.name === "AbortPromptError"
    ) {
      console.log("");
      console.log("Operación cancelada.");
      return;
    }

    console.error("");
    console.error(error.message);
    process.exitCode = 1;
  }
}

await ejecutar();