import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./agenda.css";

function hoy() {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const valor = tipo => partes.find(p => p.type === tipo).value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}
const dinero = valor => new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" }).format(Number(valor));
export default function Reportes({ token, onSesionExpirada }) {
  const [desde, setDesde] = useState(() => hoy().slice(0,7) + "-01");
  const [hasta, setHasta] = useState(hoy);
  const [doctorId, setDoctorId] = useState("");
  const [consulta, setConsulta] = useState(() => ({ desde: hoy().slice(0,7) + "-01", hasta: hoy(), doctor_id: "" }));
  const [resultado, setResultado] = useState(null);
  const [doctores, setDoctores] = useState([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    async function cargar() {
      setCargando(true); setError("");
      try {
        const datos = await consultarApi(`/api/reportes?${new URLSearchParams(consulta)}`, { token });
        if (vigente) {
          setResultado(datos);
          if (!consulta.doctor_id) setDoctores(datos.doctores.map(d => ({ id: d.id, nombre: d.nombre })));
        }
      } catch (fallo) { if (vigente) { setResultado(null); setError(fallo.message); if (fallo.status === 401) onSesionExpirada(); } }
      finally { if (vigente) setCargando(false); }
    }
    void cargar(); return () => { vigente = false; };
  }, [consulta, token, onSesionExpirada]);
  const filas = resultado?.doctores ?? [];
  const totalCentavos = filas.reduce((s,d) => s + Math.round(Number(d.ingresos) * 100), 0);
  return <section className="modulo-agenda">
    <header className="cabecera-modulo"><div><h1>Reportes</h1><p className="descripcion">Ingresos y actividad por fecha y doctor.</p></div></header>
    <form className="tarjeta filtros-agenda" onSubmit={e => { e.preventDefault(); setConsulta({ desde,hasta,doctor_id:doctorId }); }}>
      <div className="campo"><label htmlFor="reporte-desde">Desde</label><input id="reporte-desde" type="date" required min="1900-01-01" max={hasta} value={desde} onChange={e => setDesde(e.target.value)} /></div>
      <div className="campo"><label htmlFor="reporte-hasta">Hasta</label><input id="reporte-hasta" type="date" required min={desde} max="2100-12-31" value={hasta} onChange={e => setHasta(e.target.value)} /></div>
      <div className="campo"><label htmlFor="reporte-doctor">Doctor</label><select id="reporte-doctor" value={doctorId} onChange={e => setDoctorId(e.target.value)}><option value="">Todos</option>{doctores.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}</select></div>
      <button className="boton-principal boton-ajustado" disabled={cargando}>{cargando ? "Consultando..." : "Generar reporte"}</button>
    </form>
    {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
    {resultado && !cargando && <section className="tarjeta tarjeta-agenda">
      <h2>Ingresos: {dinero(totalCentavos / 100)}</h2>
      <p className="descripcion">Del {resultado.desde} al {resultado.hasta}, ambos inclusive. Ingresos según fecha del pago; actividad según fecha de la cita. Zona horaria: El Salvador.</p>
      <div className="tabla-desplazable"><table className="tabla-pacientes"><caption className="solo-lectores">Actividad e ingresos por doctor</caption><thead><tr><th>Doctor</th><th>Citas</th><th>Completadas</th><th>Canceladas</th><th>Pagos</th><th>Ingresos</th></tr></thead><tbody>{filas.map(d => <tr key={d.id}><td>{d.nombre}</td><td>{d.citas}</td><td>{d.completadas}</td><td>{d.canceladas}</td><td>{d.pagos}</td><td>{dinero(d.ingresos)}</td></tr>)}</tbody></table></div>
      {!filas.length && <p>No hay doctores para los filtros seleccionados.</p>}
    </section>}
  </section>;
}
