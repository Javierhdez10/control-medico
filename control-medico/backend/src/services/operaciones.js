import { pool } from "../config/db.js";

export function errorHttp(mensaje, status = 400) {
  const error = new Error(mensaje); error.status = status; return error;
}
export function validarPassword(valor) {
  if (typeof valor !== "string" || valor.trim().length < 12 || Buffer.byteLength(valor, "utf8") > 72) {
    throw errorHttp("La contraseña debe tener al menos 12 caracteres y no superar 72 bytes.");
  }
  return valor;
}
export async function transaccion(operacion) {
  const cliente = await pool.connect();
  let descartar = false;
  try {
    await cliente.query("BEGIN");
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    await cliente.query("SET LOCAL statement_timeout = '5s'");
    const resultado = await operacion(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (error) {
    try { await cliente.query("ROLLBACK"); } catch { descartar = true; }
    throw error;
  } finally { cliente.release(descartar); }
}
export async function auditar(cliente, usuarioId, accion, entidad, entidadId, detalles = {}) {
  await cliente.query(`INSERT INTO public.auditoria(usuario_id,accion,entidad,entidad_id,detalles)
    VALUES ($1,$2,$3,$4,$5::jsonb)`, [usuarioId,accion,entidad,entidadId,JSON.stringify(detalles)]);
}
export function responderError(error, req, res, next) {
  if ([400,401,403,404,409].includes(error.status)) return res.status(error.status).json({ correcto:false,mensaje:error.message });
  if (error.code === "23505") return res.status(409).json({correcto:false,mensaje:"El correo o identificador ya está registrado."});
  if (["55P03","40P01","57014"].includes(error.code)) return res.status(409).json({correcto:false,mensaje:"Otra operación está modificando estos datos. Actualiza y vuelve a intentarlo."});
  next(error);
}
