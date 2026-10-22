import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";

const rutaEnv = fileURLToPath(
  new URL("../../.env", import.meta.url)
);

dotenv.config({ path: rutaEnv });

const variablesRequeridas = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD"
];

for (const variable of variablesRequeridas) {
  if (!process.env[variable]) {
    throw new Error(
      `Falta configurar ${variable} en el archivo backend/.env`
    );
  }
}

const puertoBaseDatos = Number(process.env.DB_PORT);

if (
  !Number.isInteger(puertoBaseDatos) ||
  puertoBaseDatos < 1 ||
  puertoBaseDatos > 65535
) {
  throw new Error("DB_PORT debe ser un puerto válido.");
}

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: puertoBaseDatos,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000
});

pool.on("error", (error) => {
  console.error(
    "Error en una conexión inactiva de PostgreSQL:",
    error.code ?? "SIN_CODIGO"
  );
});

export { pool };