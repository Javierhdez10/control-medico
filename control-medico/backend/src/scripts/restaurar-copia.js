import { pool } from "../config/db.js";
import { restaurarCopia } from "../services/respaldos.js";
try{
  const [archivo,nombre]=process.argv.slice(2);
  if(!archivo||!nombre)throw new Error("Uso: npm.cmd run restaurar:copia -- archivo.dump control_medico_restaurado_nombre");
  await restaurarCopia(archivo,nombre,pool);console.log(`Restauración terminada en ${nombre}. La base original no se modificó.`);
}catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
