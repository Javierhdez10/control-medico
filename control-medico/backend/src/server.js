import express from "express";
import cors from "cors";
import { pool } from "./config/db.js";

import authRoutes from "./routes/auth.routes.js";
import pacientesRoutes from "./routes/pacientes.routes.js";
import agendaRoutes from "./routes/agenda.routes.js";
import historialRoutes from "./routes/historial.routes.js";
import cobrosRoutes from "./routes/cobros.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import agendaDoctorRoutes from "./routes/agenda-doctor.routes.js";
import doctoresRoutes from "./routes/doctores.routes.js";

const app = express();

const puerto = Number(process.env.PORT ?? 3000);

const origenFrontend =
  process.env.FRONTEND_URL ?? "http://localhost:5173";

if (
  !Number.isInteger(puerto) ||
  puerto < 1 ||
  puerto > 65535
) {
  throw new Error("PORT debe contener un puerto válido.");
}

app.disable("x-powered-by");

app.use(
  cors({
    origin: origenFrontend
  })
);

app.use(
  express.json({
    limit: "1mb"
  })
);

app.get("/", (req, res) => {
  res.json({
    correcto: true,
    mensaje: "API de Control Médico en funcionamiento."
  });
});

app.get("/api/salud", async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        current_database() AS base_de_datos,
        CURRENT_TIMESTAMP AS fecha_servidor
    `);

    res.json({
      correcto: true,
      mensaje: "Conexión con PostgreSQL establecida.",
      datos: resultado.rows[0]
    });
  } catch (error) {
    console.error(
      "Error al comprobar la base de datos:",
      error.code ?? "SIN_CODIGO"
    );

    res.status(503).json({
      correcto: false,
      mensaje: "La base de datos no está disponible."
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/pacientes", pacientesRoutes);
app.use("/api/agenda", agendaRoutes);
app.use("/api/historial", historialRoutes);
app.use("/api/cobros", cobrosRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/agenda-doctor", agendaDoctorRoutes);
app.use("/api/doctores", doctoresRoutes);

app.use((req, res) => {
  res.status(404).json({
    correcto: false,
    mensaje: "La ruta solicitada no existe."
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      correcto: false,
      mensaje: "El cuerpo de la solicitud no contiene JSON válido."
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      correcto: false,
      mensaje: "La solicitud supera el tamaño permitido."
    });
  }

  console.error(
    "Error al procesar la solicitud:",
    error.code ?? error.name ?? "SIN_CODIGO"
  );

  return res.status(500).json({
    correcto: false,
    mensaje: "Ocurrió un error interno. Inténtalo nuevamente."
  });
});

let servidor;
let cerrando = false;

async function cerrarServidor(senal) {
  if (cerrando) {
    return;
  }

  cerrando = true;

  console.log(`Cerrando el servidor por ${senal}.`);

  const limite = setTimeout(() => {
    console.error("Se agotó el tiempo para cerrar el servidor.");
    process.exit(1);
  }, 10000);

  limite.unref();

  try {
    if (servidor?.listening) {
      await new Promise((resolve, reject) => {
        servidor.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    await pool.end();

    clearTimeout(limite);
    process.exit(0);
  } catch (error) {
    console.error(
      "No se pudo cerrar correctamente:",
      error.code ?? "SIN_CODIGO"
    );

    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void cerrarServidor("SIGINT");
});

process.on("SIGTERM", () => {
  void cerrarServidor("SIGTERM");
});

async function iniciarServidor() {
  try {
    await pool.query("SELECT 1");

    servidor = app.listen(puerto, "127.0.0.1", () => {
      console.log(
        `Servidor disponible en http://127.0.0.1:${puerto}`
      );

      console.log(
        "Módulos: autenticación, pacientes, agenda, historial, cobros, dashboard, agenda del doctor y administración de doctores."
      );
    });

    servidor.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `El puerto ${puerto} ya está ocupado. Cierra la otra instancia del backend.`
        );
      } else {
        console.error(
          "No se pudo iniciar el servidor:",
          error.code ?? "SIN_CODIGO"
        );
      }

      void cerrarServidor("error del servidor");
    });
  } catch (error) {
    console.error(
      "No se pudo conectar con PostgreSQL:",
      error.code ?? "SIN_CODIGO"
    );

    await pool.end();
    process.exitCode = 1;
  }
}

void iniciarServidor();