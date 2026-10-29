import { useEffect, useState } from "react";
import { consultarApi } from "./api.js";
import useConfirmacion from "./useConfirmacion.jsx";

export default function Usuarios({token,onSesionExpirada}) {
  const [solicitar,dialogo]=useConfirmacion();
  const [usuarios,setUsuarios]=useState([]), [pagina,setPagina]=useState(1), [paginas,setPaginas]=useState(1);
  const [buscar,setBuscar]=useState(""), [filtro,setFiltro]=useState(""), [revision,setRevision]=useState(0);
  const [formulario,setFormulario]=useState(null), [error,setError]=useState(""), [aviso,setAviso]=useState("");
  const [ocupado,setOcupado]=useState(false), [cargando,setCargando]=useState(true), [codigo,setCodigo]=useState("");
  useEffect(()=>{let vigente=true; async function cargar(){setCargando(true);try{
    const datos=await consultarApi(`/api/usuarios?${new URLSearchParams({pagina,buscar:filtro})}`,{token});
    if(vigente){setUsuarios(datos.usuarios);setPaginas(datos.total_paginas);}
  }catch(fallo){if(vigente){setError(fallo.message);if(fallo.status===401)onSesionExpirada();}}finally{if(vigente)setCargando(false);}}
  void cargar();return()=>{vigente=false;};},[token,pagina,filtro,revision,onSesionExpirada]);
  async function ejecutar(ruta,cuerpo,method="POST") {
    setOcupado(true);setError("");setAviso("");setCodigo("");
    try{
      const datos=await consultarApi(ruta,{token,method,headers:{"Content-Type":"application/json"},body:JSON.stringify(cuerpo)});
      setAviso(datos.mensaje);setCodigo(datos.codigo||"");setRevision(n=>n+1);return true;
    }catch(fallo){setError(fallo.message);if(fallo.status===401)onSesionExpirada();return false;}finally{setOcupado(false);}
  }
  async function cambiarEstado(usuario){
    if(!await solicitar({titulo:usuario.activo?"Desactivar cuenta":"Activar cuenta",descripcion:`${usuario.nombre} (${usuario.email}). Se cerrarán las sesiones anteriores. Las citas y registros se conservarán.`}))return;
    await ejecutar(`/api/usuarios/${usuario.id}/estado`,{activo:!usuario.activo},"PATCH");
  }
  async function recuperar(usuario){
    const datos=await solicitar({titulo:"Generar recuperación de acceso",descripcion:`Verifica la identidad de ${usuario.nombre} antes de entregar el código. Confirma tu contraseña de administrador.`,campos:[{nombre:"password_admin",etiqueta:"Tu contraseña de administrador",tipo:"password"}],boton:"Generar código"});
    if(datos)await ejecutar(`/api/usuarios/${usuario.id}/recuperacion`,datos);
  }
  async function guardar(e){e.preventDefault();if(ocupado)return;
    if(!formulario.id && formulario.password!==formulario.confirmacion){setError("Las contraseñas no coinciden.");return;}
    if(await ejecutar(formulario.id?`/api/usuarios/${formulario.id}`:"/api/usuarios",formulario,formulario.id?"PUT":"POST"))setFormulario(null);
  }
  return <section>{dialogo}<header className="cabecera-modulo"><div><h1>Cuentas de acceso</h1><p className="descripcion">Administra recepción y el acceso a la aplicación.</p></div><button className="boton-principal boton-ajustado" disabled={ocupado} onClick={()=>{setFormulario({nombre:"",email:"",telefono:"",password:"",confirmacion:""});setCodigo("");setError("");}}>Nueva cuenta de recepción</button></header>
    {error&&<p className="mensaje mensaje-error" role="alert">{error}</p>}{aviso&&<p className="mensaje mensaje-aviso" role="status">{aviso}</p>}
    {codigo&&<section className="tarjeta tarjeta-gestion"><h2>Código de un solo uso</h2><p>Entrégalo por un medio privado a la persona cuya identidad verificaste. No se volverá a mostrar.</p><code className="codigo-recuperacion">{codigo}</code><button className="boton-secundario" onClick={()=>setCodigo("")}>Ocultar código</button></section>}
    {formulario?<form className="tarjeta tarjeta-gestion" onSubmit={guardar}><h2>{formulario.id?"Editar recepción":"Registrar recepción"}</h2>
      {[["nombre","Nombre","text"],["email","Correo de acceso","email"],["telefono","Teléfono","tel"],...(!formulario.id?[["password","Contraseña (mínimo 12 caracteres)","password"],["confirmacion","Confirmar contraseña","password"]]:[])].map(([campo,etiqueta,tipo])=><div className="campo" key={campo}><label htmlFor={`usr-${campo}`}>{etiqueta}</label><input id={`usr-${campo}`} type={tipo} required={campo!=="telefono"} minLength={tipo==="password"?12:undefined} maxLength={campo==="nombre"?150:campo==="telefono"?25:campo==="email"?254:undefined} autoComplete={tipo==="password"?"new-password":"off"} disabled={ocupado} value={formulario[campo]||""} onChange={e=>setFormulario(f=>({...f,[campo]:e.target.value}))}/></div>)}
      <div className="acciones-flex"><button className="boton-principal" disabled={ocupado}>Guardar cuenta</button><button type="button" className="boton-secundario" disabled={ocupado} onClick={()=>setFormulario(null)}>Volver</button></div></form>:<>
      <form className="acciones-flex" onSubmit={e=>{e.preventDefault();setFiltro(buscar);setPagina(1);setRevision(n=>n+1);}}><label htmlFor="buscar-cuenta">Buscar cuenta</label><input id="buscar-cuenta" maxLength={150} value={buscar} onChange={e=>setBuscar(e.target.value)}/><button className="boton-secundario" disabled={ocupado}>Buscar</button></form>
      <section className="tarjeta tarjeta-gestion"><div className="tabla-desplazable"><table className="tabla-pacientes"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{usuarios.map(u=><tr key={u.id}><td>{u.nombre}</td><td>{u.email}</td><td>{u.rol}</td><td>{u.activo?"Activo":"Inactivo"}</td><td><div className="acciones-flex">
        {u.rol==="recepcionista"&&<button className="boton-secundario" disabled={ocupado} onClick={()=>{setFormulario(u);setError("");}}>Editar</button>}
        {["recepcionista","paciente"].includes(u.rol)&&<button className="boton-secundario" disabled={ocupado} onClick={()=>cambiarEstado(u)}>{u.activo?"Desactivar":"Activar"}</button>}
        <button className="boton-secundario" disabled={ocupado||!u.activo} onClick={()=>recuperar(u)}>Recuperar acceso</button>
      </div></td></tr>)}</tbody></table></div>{cargando&&<p role="status">Cargando cuentas...</p>}{!cargando&&!usuarios.length&&<p>No se encontraron cuentas.</p>}
      <footer className="paginacion"><button className="boton-secundario" disabled={ocupado||pagina<=1} onClick={()=>setPagina(p=>p-1)}>Anterior</button><span>Página {pagina} de {paginas}</span><button className="boton-secundario" disabled={ocupado||pagina>=paginas} onClick={()=>setPagina(p=>p+1)}>Siguiente</button></footer></section></>}
  </section>;
}
