import { useState } from "react";
import { consultarApi } from "./api.js";

export default function CuentaPaciente({ paciente, token, onCerrar, onSesionExpirada }) {
  const [email, setEmail] = useState(paciente.email || "");
  const [password, setPassword] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  async function guardar(evento) {
    evento.preventDefault();
    if (ocupado) return;
    setError("");
    if (password !== confirmacion) { setError("Las contraseñas no coinciden."); return; }
    setOcupado(true);
    try {
      const datos = await consultarApi(`/api/pacientes/${paciente.id}/cuenta`, {
        token, method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      setPassword(""); setConfirmacion(""); setAviso(datos.mensaje);
    } catch (fallo) {
      if (fallo.status === 401) onSesionExpirada();
      else setError(fallo.message);
    } finally { setOcupado(false); }
  }
  return <section className="tarjeta formulario-paciente" aria-label="Cuenta de acceso del paciente">
    <h2>Cuenta de acceso: {paciente.nombre}</h2>
    <p className="descripcion">Esta cuenta se vinculará a su ficha existente y permitirá gestionar sus propias citas. Entrega las credenciales al paciente de forma privada.</p>
    {aviso ? <p className="mensaje mensaje-aviso" role="status">{aviso}</p> :
      <form onSubmit={guardar}>
        <div className="campo"><label htmlFor="cuenta-email">Correo para iniciar sesión</label><input id="cuenta-email" type="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} disabled={ocupado} /></div>
        <div className="campo"><label htmlFor="cuenta-password">Contraseña (mínimo 12 caracteres)</label><input id="cuenta-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} disabled={ocupado} /></div>
        <div className="campo"><label htmlFor="cuenta-confirmacion">Confirmar contraseña</label><input id="cuenta-confirmacion" type="password" autoComplete="new-password" required value={confirmacion} onChange={e => setConfirmacion(e.target.value)} disabled={ocupado} /></div>
        {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
        <button className="boton-principal" disabled={ocupado}>{ocupado ? "Creando..." : "Crear cuenta"}</button>
      </form>}
    <button type="button" className="boton-secundario" onClick={onCerrar} disabled={ocupado}>Cerrar</button>
  </section>;
}
