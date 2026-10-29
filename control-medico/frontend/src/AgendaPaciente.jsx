import useConfirmacion from "./useConfirmacion.jsx";
import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import "./agenda.css";

function fechaLocal(valor = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(valor));
  const parte = tipo => partes.find(p => p.type === tipo).value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
const fechaHora = valor => new Intl.DateTimeFormat("es-SV", { timeZone: "America/El_Salvador", dateStyle: "medium", timeStyle: "short" }).format(new Date(valor));

export default function AgendaPaciente({ token, onSesionExpirada }) {
  const [solicitar,dialogo]=useConfirmacion();
  const [grupo,setGrupo]=useState("proximas");
  const [doctores, setDoctores] = useState([]);
  const [citas, setCitas] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [revision, setRevision] = useState(0);
  const [formulario, setFormulario] = useState(null);
  const [disponibilidad, setDisponibilidad] = useState(null);
  const [hora, setHora] = useState("");
  const [error, setError] = useState("");
  const [errorHorarios, setErrorHorarios] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const doctorId = formulario?.doctor_id ?? "";
  const fecha = formulario?.fecha ?? "";
  const duracion = formulario?.duracion ?? 30;
  const citaId = formulario?.original?.id;
  const clave = `${doctorId}|${fecha}|${duracion}|${citaId || ""}|${revision}`;
  const horarios = disponibilidad?.clave === clave ? disponibilidad.horarios : [];
  const horaValida = horarios.some(h => h.hora === hora);

  useEffect(() => {
    let vigente = true, temporizador;
    async function cargar() {
      try {
        const [lista, profesionales] = await Promise.all([
          consultarApi(`/api/agenda/mis-citas?pagina=${pagina}&grupo=${grupo}`, { token }),
          consultarApi("/api/agenda/doctores", { token })
        ]);
        if (vigente) { setCitas(lista.citas); setPaginas(lista.total_paginas); setDoctores(profesionales.doctores); }
      } catch (fallo) {
        if (vigente) { if (fallo.status === 401) onSesionExpirada(); else setError(fallo.message); }
      } finally {
        if (vigente) { setCargando(false); temporizador = setTimeout(cargar, 15000); }
      }
    }
    void cargar();
    return () => { vigente = false; clearTimeout(temporizador); };
  }, [token, pagina, grupo, revision, onSesionExpirada]);

  useEffect(() => {
    if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return undefined;
    let vigente = true, temporizador;
    async function cargar() {
      try {
        const parametros = new URLSearchParams({ doctor_id: doctorId, fecha, duracion });
        const ruta = citaId ? `/api/agenda/citas/${citaId}/disponibilidad` : "/api/agenda/disponibilidad";
        const resultado = await consultarApi(`${ruta}?${parametros}`, { token });
        if (vigente) { setDisponibilidad({ clave, horarios: resultado.horarios }); setErrorHorarios(""); }
      } catch (fallo) {
        if (vigente) { setDisponibilidad(null); setErrorHorarios(fallo.message); if (fallo.status === 401) onSesionExpirada(); }
      } finally { if (vigente) temporizador = setTimeout(cargar, 15000); }
    }
    void cargar();
    return () => { vigente = false; clearTimeout(temporizador); };
  }, [token, doctorId, fecha, duracion, citaId, clave, onSesionExpirada]);

  function abrir(cita = null) {
    setError(""); setAviso(""); setHora(""); setDisponibilidad(null); setErrorHorarios("");
    setFormulario({ doctor_id: cita ? String(cita.doctor_id) : "", fecha: cita ? fechaLocal(cita.fecha_hora) : fechaLocal(), duracion: cita?.duracion ?? 30, motivo: cita?.motivo ?? "", original: cita });
  }
  function cambiar(campo, valor) { setHora(""); setFormulario(actual => ({ ...actual, [campo]: valor })); }
  async function guardar(evento) {
    evento.preventDefault();
    if (ocupado || !horaValida) return;
    setOcupado(true); setError("");
    try {
      const original = formulario.original;
      const cuerpo = { doctor_id: Number(doctorId), fecha, duracion: Number(duracion), hora, motivo: formulario.motivo };
      if (original) Object.assign(cuerpo, { fecha_hora_original: original.fecha_hora, fecha_hora_fin_original: original.fecha_hora_fin, estado_original: original.estado });
      const resultado = await consultarApi(original ? `/api/agenda/citas/${original.id}/reprogramar` : "/api/agenda/citas", {
        token, method: original ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo)
      });
      setFormulario(null); setGrupo("proximas"); setAviso(resultado.mensaje); setPagina(1); setRevision(n => n + 1);
    } catch (fallo) {
      if (fallo.status === 401) onSesionExpirada();
      else { setError(fallo.message); setHora(""); setRevision(n => n + 1); }
    } finally { setOcupado(false); }
  }
  async function cancelar(cita) {
    const respuesta=await solicitar({titulo:"Cancelar mi cita",descripcion:`Doctor: ${cita.doctor}\nFecha: ${fechaHora(cita.fecha_hora)}`,campos:[{nombre:"motivo",etiqueta:"Motivo de cancelación",maxLength:1000}],boton:"Cancelar cita"});
    if(!respuesta) return;
    const motivo=respuesta.motivo;
    if (!motivo.trim() || motivo.trim().length > 1000) { setError("Escribe un motivo de entre 1 y 1000 caracteres."); return; }
    setOcupado(true); setError("");
    try {
      const resultado = await consultarApi(`/api/agenda/citas/${cita.id}/estado`, { token, method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado: "cancelada", motivo_cancelacion: motivo.trim() }) });
      setAviso(resultado.mensaje); setRevision(n => n + 1);
    } catch (fallo) { if (fallo.status === 401) onSesionExpirada(); else setError(fallo.message); }
    finally { setOcupado(false); }
  }
  return <section className="modulo-agenda">
    {dialogo}
    <header className="cabecera-modulo"><div><h1>Mis citas</h1><p className="descripcion">Reserva y consulta tus citas. Horarios de El Salvador.</p></div>
      {!formulario && <button className="boton-principal boton-ajustado" disabled={ocupado || cargando} onClick={() => abrir()}>Reservar cita</button>}
    </header>
    {!formulario && <div className="filtros-citas" aria-label="Filtrar citas">{[["proximas","Próximas"],["anteriores","Anteriores"],["todas","Todas"]].map(([valor,texto])=><button key={valor} className="boton-secundario" aria-pressed={grupo===valor} disabled={ocupado} onClick={()=>{if(grupo===valor)return;setGrupo(valor);setPagina(1);setCargando(true);}}>{texto}</button>)}</div>}
    {error && <p className="mensaje mensaje-error" role="alert">{error}</p>}
    {aviso && <p className="mensaje mensaje-aviso" role="status">{aviso}</p>}
    {formulario ? <form className="tarjeta tarjeta-agenda" onSubmit={guardar}>
      <h2>{citaId ? "Reprogramar cita" : "Nueva reserva"}</h2>
      <p className="descripcion">{citaId ? "Se conservarán el doctor, motivo e importe de tu cita." : "Recepción establecerá el importe de la consulta al confirmar tu reserva."}</p>
      <div className="campo"><label htmlFor="pac-doctor">Doctor</label><select id="pac-doctor" required value={doctorId} disabled={ocupado || Boolean(citaId)} onChange={e => cambiar("doctor_id", e.target.value)}>
        <option value="">Selecciona un doctor</option>{doctores.map(d => <option key={d.id} value={d.id}>{d.nombre} — {d.especialidad}</option>)}
        {citaId && !doctores.some(d => String(d.id) === doctorId) && <option value={doctorId}>{formulario.original.doctor}</option>}
      </select></div>
      <div className="campo"><label htmlFor="pac-fecha">Fecha</label><input id="pac-fecha" type="date" required min={fechaLocal()} max="2100-12-31" value={fecha} disabled={ocupado} onChange={e => cambiar("fecha", e.target.value)} /></div>
      <div className="campo"><label htmlFor="pac-duracion">Duración</label><select id="pac-duracion" value={duracion} disabled={ocupado} onChange={e => cambiar("duracion", Number(e.target.value))}>{[15,30,45,60].map(n => <option key={n} value={n}>{n} minutos</option>)}</select></div>
      {errorHorarios && <p className="mensaje mensaje-error" role="alert">{errorHorarios}</p>}
      <div className="campo"><label htmlFor="pac-hora">Hora disponible</label><select id="pac-hora" required value={horaValida ? hora : ""} disabled={ocupado || !horarios.length} onChange={e => setHora(e.target.value)}><option value="">Selecciona una hora</option>{horarios.map(h => <option key={h.hora} value={h.hora}>{h.hora}</option>)}</select></div>
      {doctorId && !errorHorarios && <p className="descripcion" role="status">{disponibilidad?.clave !== clave ? "Consultando disponibilidad..." : horarios.length ? "La disponibilidad se actualiza cada 15 segundos y se vuelve a comprobar al guardar." : "No hay horarios disponibles para esta fecha y duración."}</p>}
      <div className="campo"><label htmlFor="pac-motivo">Motivo de la consulta</label><input id="pac-motivo" required maxLength={2000} value={formulario.motivo} disabled={ocupado || Boolean(citaId)} onChange={e => setFormulario(actual => ({ ...actual, motivo: e.target.value }))} /></div>
      <div className="acciones-cabecera"><button className="boton-principal boton-ajustado" disabled={ocupado || !horaValida}>{ocupado ? "Guardando..." : citaId ? "Guardar cambio" : "Reservar"}</button><button type="button" className="boton-secundario" disabled={ocupado} onClick={() => setFormulario(null)}>Volver a mis citas</button></div>
    </form> : <section className="tarjeta tarjeta-agenda">
      {cargando ? <p role="status">Cargando citas...</p> : !citas.length ? <p>No tienes citas registradas.</p> : <div className="lista-citas">{citas.map(c => <article className={`bloque-cita cita-${c.estado}`} key={c.id}>
        <div className="detalle-cita"><h3>{grupo==="proximas" && c.id===citas[0]?.id ? "Próxima consulta: " : ""}{c.doctor}</h3><p>{fechaHora(c.fecha_hora)} · {c.duracion} minutos</p><p>{c.motivo}</p><p>Estado: {c.estado}</p><p>{c.importe_pendiente ? "Importe pendiente de confirmar por recepción" : new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" }).format(Number(c.importe_total))}</p>{c.motivo_cancelacion && <p>Cancelación: {c.motivo_cancelacion}</p>}</div>
        {["pendiente", "confirmada"].includes(c.estado) && <div className="acciones-cita"><button className="boton-secundario" disabled={ocupado} onClick={() => abrir(c)}>Reprogramar</button><button className="boton-secundario" disabled={ocupado} onClick={() => cancelar(c)}>Cancelar cita</button></div>}
      </article>)}</div>}
      <footer className="paginacion"><button className="boton-secundario" disabled={ocupado || pagina <= 1} onClick={() => { setCargando(true); setPagina(p => p - 1); }}>Anterior</button><span>Página {pagina} de {paginas}</span><button className="boton-secundario" disabled={ocupado || pagina >= paginas} onClick={() => { setCargando(true); setPagina(p => p + 1); }}>Siguiente</button></footer>
    </section>}
  </section>;
}
