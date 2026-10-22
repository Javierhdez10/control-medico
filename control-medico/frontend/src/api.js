export async function consultarApi(ruta, opciones = {}) {
  const { token, ...configuracion } = opciones;

  const headers = new Headers(configuracion.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let respuesta;

  try {
    respuesta = await fetch(ruta, {
      ...configuracion,
      headers,
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    const mensaje =
      error.name === "TimeoutError"
        ? "El servidor tardó demasiado. Comprueba el resultado antes de volver a guardar."
        : "No se pudo contactar con el servidor. Comprueba que el backend esté encendido.";

    throw new Error(mensaje);
  }

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok || datos?.correcto !== true) {
    const error = new Error(
      datos?.mensaje || "El servidor devolvió una respuesta inesperada."
    );

    error.status = respuesta.status;
    throw error;
  }

  return datos;
}