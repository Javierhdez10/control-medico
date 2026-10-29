import { useEffect,useId,useRef } from "react";
export default function Dialogo({ opciones, terminar }) {
  const ref = useRef(null), tituloId = useId();
  useEffect(() => { const dialogo = ref.current; dialogo.showModal(); return () => dialogo.close(); }, []);
  return <dialog ref={ref} className="dialogo-clinica" aria-labelledby={tituloId} onCancel={e => { e.preventDefault(); terminar(null); }}>
    <form onSubmit={e => { e.preventDefault(); terminar(Object.fromEntries(new FormData(e.currentTarget))); }}>
      <h2 id={tituloId}>{opciones.titulo}</h2>
      <p className="descripcion">{opciones.descripcion}</p>
      {(opciones.campos ?? []).map(campo => <div className="campo" key={campo.nombre}>
        <label htmlFor={`${tituloId}-${campo.nombre}`}>{campo.etiqueta}</label>
        <input id={`${tituloId}-${campo.nombre}`} name={campo.nombre} type={campo.tipo || "text"} required={campo.obligatorio !== false} min={campo.min} maxLength={campo.maxLength ?? 1000} step={campo.step} defaultValue={campo.valor ?? ""} autoComplete={campo.tipo === "password" ? "current-password" : "off"} />
      </div>)}
      <div className="acciones-formulario"><button type="button" className="boton-secundario" onClick={() => terminar(null)}>Volver</button><button className="boton-principal boton-ajustado">{opciones.boton || "Confirmar"}</button></div>
    </form>
  </dialog>;
}
