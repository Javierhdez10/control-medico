import { pool } from "../config/db.js";
import { crearRespaldo } from "../services/respaldos.js";
try{console.log(JSON.stringify(await crearRespaldo(pool,{verificar:process.argv.includes("--verificar")}),null,2));}
catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
