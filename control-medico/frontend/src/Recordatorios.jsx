import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";

const estados = { enviado: "Aceptado por el servidor de correo", fallido: "Falló el envío", incierto: "Requiere revisión", omitido: "Omitido", enviando: "En proceso" };

export default function Recordatorios({ token, onSesionExpirada }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    async function cargar() {
      setCargando(true); setError("");
      try {
        const respuesta = await consultarApi("/api/recordatorios", { token });
        if (vigente) setDatos(respuesta);
      } catch (fallo) {
        if (vigente) {
          setError(fallo.message);
          if (fallo.status === 401) onSesionExpirada();
        }
      } finally { if (vigente) setCargando(false); }
    }
    void cargar();
    return () => { vigente = false; };
  }, [token, revision, onSesionExpirada]);
  return <section>
    <header className="cabecera-modulo"><div><h1>Recordatorios</h1><p className="descripcion">Seguimiento de los últimos 100 avisos de citas.</p></div><button className="boton-secundario" disabled={cargando} onClick={() => setRevision(n => n + 1)}>Actualizar</button></header>
    {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
    {cargando && <p role="status">Cargando...</p>}
    {datos && <section className="tarjeta tarjeta-gestion">
      <h2>{datos.activo ? "Envío automático activado" : "Envío automático desactivado"}</h2>
      <p className="descripcion">Se avisan las citas confirmadas que comienzan en las próximas 24 horas. Una aceptación del servidor de correo no confirma la recepción en la bandeja del paciente.</p>
      {!datos.activo && <p>El administrador debe configurar el servicio de correo antes de activar los avisos.</p>}
      <div className="tabla-desplazable"><table className="tabla-pacientes"><thead><tr><th>Cita</th><th>Fecha de consulta</th><th>Estado del aviso</th><th>Intentos</th></tr></thead><tbody>
        {datos.recordatorios.map(r => <tr key={r.id}><td>#{r.cita_id}</td><td>{new Intl.DateTimeFormat("es-SV", { timeZone: "America/El_Salvador", dateStyle: "short", timeStyle: "short" }).format(new Date(r.inicio_cita))}</td><td>{estados[r.estado] ?? r.estado}</td><td>{r.intentos}</td></tr>)}
      </tbody></table></div>
      {!datos.recordatorios.length && <p className="estado-vacio">Todavía no hay avisos registrados.</p>}
      <p className="descripcion">Los avisos que requieren revisión no se reenvían automáticamente para evitar duplicados. Recepción puede confirmar la cita con el paciente por su canal habitual.</p>
    </section>}
  </section>;
}
