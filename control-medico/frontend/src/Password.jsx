import { useState } from "react";
import { consultarApi } from "./api.js";

export default function Password({ token, recuperacion = false, onFinalizar, onCancelar }) {
  const [actual,setActual]=useState("");
  const [codigo,setCodigo]=useState("");
  const [nueva,setNueva]=useState("");
  const [confirmacion,setConfirmacion]=useState("");
  const [ocupado,setOcupado]=useState(false);
  const [error,setError]=useState("");
  async function guardar(e) {
    e.preventDefault(); if(ocupado) return; setError("");
    if(nueva!==confirmacion) {setError("Las contraseñas no coinciden.");return;}
    setOcupado(true);
    try {
      const datos=await consultarApi(recuperacion?"/api/auth/recuperar":"/api/auth/password",{token,method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(recuperacion?{codigo:codigo.trim(),nueva}:{actual,nueva})});
      setActual("");setNueva("");setConfirmacion("");setCodigo("");onFinalizar(datos.mensaje);
    } catch(fallo) {setError(fallo.message);} finally{setOcupado(false);}
  }
  return <section className="tarjeta tarjeta-gestion"><h2>{recuperacion?"Recuperar acceso":"Cambiar contraseña"}</h2>
    <p className="descripcion">{recuperacion?"Solicita un código al administrador de la clínica, quien verificará tu identidad. El código vence en 30 minutos y solo se puede usar una vez.":"Al guardar se cerrarán tus sesiones anteriores. Usa al menos 12 caracteres."}</p>
    <form onSubmit={guardar}>
      {recuperacion?<div className="campo"><label htmlFor="rec-codigo">Código de recuperación</label><input id="rec-codigo" required value={codigo} maxLength={64} autoComplete="off" disabled={ocupado} onChange={e=>setCodigo(e.target.value)} /></div>:<div className="campo"><label htmlFor="pwd-actual">Contraseña actual</label><input id="pwd-actual" type="password" autoComplete="current-password" required disabled={ocupado} value={actual} onChange={e=>setActual(e.target.value)} /></div>}
      <div className="campo"><label htmlFor="pwd-nueva">Nueva contraseña</label><input id="pwd-nueva" type="password" autoComplete="new-password" minLength={12} required disabled={ocupado} value={nueva} onChange={e=>setNueva(e.target.value)} /></div>
      <div className="campo"><label htmlFor="pwd-confirmacion">Confirmar contraseña</label><input id="pwd-confirmacion" type="password" autoComplete="new-password" required disabled={ocupado} value={confirmacion} onChange={e=>setConfirmacion(e.target.value)} /></div>
      {error&&<p className="mensaje mensaje-error" role="alert">{error}</p>}
      <div className="acciones-flex"><button className="boton-principal" disabled={ocupado}>{ocupado?"Guardando...":"Guardar contraseña"}</button>{onCancelar&&<button type="button" className="boton-secundario" disabled={ocupado} onClick={onCancelar}>Volver</button>}</div>
    </form>
  </section>;
}
