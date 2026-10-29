import { spawn } from "node:child_process";
import { access,mkdir,readdir } from "node:fs/promises";
import { join,resolve,basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

async function binario(nombre){
  if(process.env.PG_BIN){const ruta=join(process.env.PG_BIN,nombre+".exe");await access(ruta);return ruta;}
  const raiz="C:\\Program Files\\PostgreSQL";
  const versiones=await readdir(raiz).catch(()=>[]);
  for(const version of versiones.sort((a,b)=>Number(b)-Number(a))){const ruta=join(raiz,version,"bin",nombre+".exe");try{await access(ruta);return ruta;}catch{ /* Buscar siguiente versión. */ }}
  return nombre;
}
export async function ejecutarPG(nombre,args){
  const ejecutable=await binario(nombre);
  return new Promise((resolve,reject)=>{
    const hijo=spawn(ejecutable,args,{windowsHide:true,env:{...process.env,PGHOST:process.env.DB_HOST,PGPORT:process.env.DB_PORT,PGUSER:process.env.DB_USER,PGPASSWORD:process.env.DB_PASSWORD},stdio:["ignore","ignore","pipe"]});
    let error="";
    hijo.stderr.on("data",datos=>{error=(error+datos.toString()).slice(-2000);});
    hijo.on("error",()=>reject(new Error(`No se pudo iniciar ${nombre}. Configura PG_BIN con la carpeta bin de PostgreSQL.`)));
    hijo.on("close",codigo=>{if(codigo===0)resolve();else reject(new Error(`${nombre} falló (código ${codigo}). Comprueba disponibilidad, permisos y versión de PostgreSQL. ${error.replaceAll(process.env.DB_PASSWORD||"__SIN_PASSWORD__","[oculto]")}`));});
  });
}
function conexion(database){return new pg.Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database,connectionTimeoutMillis:5000});}
export async function restaurarCopia(archivo,nombre,mantenimiento){
  if(!/^control_medico_(restaurado|verificacion)_[a-z0-9_]+$/.test(nombre))throw new Error("La base destino debe comenzar con control_medico_restaurado_ y ser nueva.");
  await access(archivo);
  const existe=await mantenimiento.query("SELECT 1 FROM pg_database WHERE datname=$1",[nombre]);
  if(existe.rowCount)throw new Error("La base destino ya existe. No se sobrescribió.");
  await mantenimiento.query(`CREATE DATABASE "${nombre}"`);
  try{await ejecutarPG("pg_restore",["--exit-on-error","--no-owner","--no-privileges","--dbname",nombre,resolve(archivo)]);}
  catch(error){throw new Error(`No se completó la restauración. Se conservó la base nueva ${nombre} para revisión. ${error.message}`);}
}
export async function crearRespaldo(pool,{verificar=false}={}){
  const carpeta=fileURLToPath(new URL("../../../respaldos/",import.meta.url));
  await mkdir(carpeta,{recursive:true});
  const archivo=join(carpeta,`control-medico-${new Date().toISOString().replaceAll(":","-")}-${randomUUID().slice(0,8)}.dump`);
  const cliente=await pool.connect();
  let cuentas;
  try{
    await cliente.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot=(await cliente.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    const tablas=(await cliente.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    cuentas={};
    for(const {tablename} of tablas){if(!/^[a-z_]+$/.test(tablename))throw new Error("Nombre de tabla inesperado.");cuentas[tablename]=(await cliente.query(`SELECT count(*)::text AS total FROM public."${tablename}"`)).rows[0].total;}
    await ejecutarPG("pg_dump",["--format=custom","--no-owner","--no-privileges","--snapshot",snapshot,"--file",archivo,"--dbname",process.env.DB_NAME]);
    await cliente.query("COMMIT");
  }catch(error){await cliente.query("ROLLBACK").catch(()=>{});throw error;}finally{cliente.release();}
  if(verificar){
    const nombre=`control_medico_verificacion_${process.pid}_${Date.now()}`;
    let creada=false,copia;
    try{
      await restaurarCopia(archivo,nombre,pool);creada=true;copia=conexion(nombre);
      for(const [tabla,total] of Object.entries(cuentas)){
        const recuperado=(await copia.query(`SELECT count(*)::text AS total FROM public."${tabla}"`)).rows[0].total;
        if(recuperado!==total)throw new Error(`La verificación falló en ${tabla}.`);
      }
    }finally{
      if(copia)await copia.end();
      if(creada && /^control_medico_verificacion_\d+_\d+$/.test(nombre))await pool.query(`DROP DATABASE "${nombre}"`);
    }
  }
  return {archivo:resolve(archivo),nombre:basename(archivo),verificado:verificar,tablas:Object.keys(cuentas).length};
}
