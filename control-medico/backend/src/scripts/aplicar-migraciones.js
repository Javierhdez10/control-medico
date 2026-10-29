import { readFile } from "node:fs/promises";
import { pool } from "../config/db.js";

try {
  const archivos = ["04_reservas_pacientes.sql", "05_administracion.sql"];
  const cliente = await pool.connect();
  try {
    await cliente.query("SET lock_timeout = '5s'");
    for (const archivo of archivos) {
      await cliente.query(await readFile(new URL(`../../../database/${archivo}`, import.meta.url), "utf8"));
    }
    console.log("Migraciones 04 y 05 aplicadas sin eliminar registros.");
  } catch (error) { await cliente.query("ROLLBACK").catch(() => {}); throw error; }
  finally { cliente.release(); }
} catch (error) {
  console.error("No se pudo aplicar la migración:", error.code ?? error.name);
  process.exitCode = 1;
} finally { await pool.end(); }
