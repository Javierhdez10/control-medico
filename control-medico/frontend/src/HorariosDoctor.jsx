import { useState } from "react";
import { consultarApi } from "./api.js";

const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export default function HorariosDoctor({ doctor, token, onCerrar, onGuardado, onSesionExpirada, onOcupado }) {
  const [horarios, setHorarios] = useState(() => doctor.horarios.map(h => ({ ...h })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  function cambiar(indice, campo, valor) {
    setHorarios(actual => actual.map((h, i) => i === indice ? { ...h, [campo]: valor } : h));
  }
  async function guardar(evento) {
    evento.preventDefault();
    if (guardando) return;
    setGuardando(true); onOcupado(true); setError("");
    try {
      const resultado = await consultarApi(`/api/doctores/${doctor.id}/horarios`, {
        token, method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horarios, originales: doctor.horarios })
      });
      onGuardado(resultado.mensaje);
    } catch (fallo) {
      if (fallo.status === 401) onSesionExpirada();
      else setError(fallo.message);
    } finally { setGuardando(false); onOcupado(false); }
  }
  return <section className="tarjeta doc-editor-horarios">
    <h2>Horario semanal de {doctor.nombre}</h2>
    <p className="descripcion">Hora de El Salvador. Puedes añadir varios intervalos por día. Las citas vigentes deben quedar completamente dentro del horario.</p>
    <form onSubmit={guardar}>
      {horarios.map((h, i) => <div className="doc-intervalo" key={i}>
        <div className="campo"><label htmlFor={`dia-${i}`}>Día</label><select id={`dia-${i}`} value={h.dia_semana} disabled={guardando} onChange={e => cambiar(i, "dia_semana", Number(e.target.value))}>{dias.map((dia, n) => <option key={dia} value={n + 1}>{dia}</option>)}</select></div>
        <div className="campo"><label htmlFor={`inicio-${i}`}>Inicio</label><input id={`inicio-${i}`} type="time" required value={h.hora_inicio} disabled={guardando} onChange={e => cambiar(i, "hora_inicio", e.target.value)} /></div>
        <div className="campo"><label htmlFor={`fin-${i}`}>Fin</label><input id={`fin-${i}`} type="time" required value={h.hora_fin} disabled={guardando} onChange={e => cambiar(i, "hora_fin", e.target.value)} /></div>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={() => setHorarios(actual => actual.filter((_, n) => n !== i))}>Quitar intervalo</button>
      </div>)}
      {!horarios.length && <p>Sin intervalos: no se podrán reservar nuevas citas.</p>}
      {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
      <div className="acciones-cabecera">
        <button type="button" className="boton-secundario" disabled={guardando || horarios.length >= 56} onClick={() => setHorarios(actual => [...actual, { dia_semana: 1, hora_inicio: "08:00", hora_fin: "12:00" }])}>Añadir intervalo</button>
        <button className="boton-principal boton-ajustado" disabled={guardando}>{guardando ? "Guardando..." : "Guardar horario"}</button>
        <button type="button" className="boton-secundario" disabled={guardando} onClick={onCerrar}>Cancelar</button>
      </div>
    </form>
  </section>;
}
