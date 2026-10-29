import { crearEnvioSMTP,procesarRecordatorios } from "./recordatorios.js";
export async function iniciarRecordatorios(){
  if(process.env.RECORDATORIOS_ACTIVOS!=="true")return async()=>{};
  const enviar=await crearEnvioSMTP();
  let terminado=false,pendiente=null,timer;
  function ejecutar(){
    if(terminado)return;
    pendiente=procesarRecordatorios(enviar).catch(error=>console.error("Error del proceso de recordatorios:",error.code??"ERROR_INTERNO")).finally(()=>{pendiente=null;if(!terminado)timer=setTimeout(ejecutar,60000);});
  }
  ejecutar();
  return async()=>{terminado=true;clearTimeout(timer);if(pendiente)await pendiente;};
}
