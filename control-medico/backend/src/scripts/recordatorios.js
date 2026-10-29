import { pool } from "../config/db.js";
import { candidatosRecordatorio, crearEnvioSMTP, procesarRecordatorios } from "../services/recordatorios.js";
try {
  if(!process.argv.includes("--enviar")){
    const candidatos=await candidatosRecordatorio();
    console.log(`Vista previa: ${candidatos.rowCount} citas confirmadas elegibles en las próximas 24 horas. No se enviaron correos.`);
  }else{
    const enviar=await crearEnvioSMTP();
    console.log(JSON.stringify(await procesarRecordatorios(enviar)));
  }
}catch(error){console.error("Recordatorios:",error.code??error.message);process.exitCode=1;}finally{await pool.end();}
