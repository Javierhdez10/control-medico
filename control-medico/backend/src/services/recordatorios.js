import { pool } from "../config/db.js";

export async function candidatosRecordatorio(conexion = pool) {
  return conexion.query(`SELECT c.id,c.fecha_hora,c.fecha_hora::text AS inicio_exacto,c.estado,COALESCE(u.email,p.email) AS email
    FROM public.citas c JOIN public.pacientes p ON p.id=c.paciente_id
    LEFT JOIN public.usuarios u ON u.id=p.usuario_id
    LEFT JOIN public.recordatorios r ON r.cita_id=c.id AND r.inicio_cita=c.fecha_hora
    WHERE c.estado='confirmada' AND p.estado<>'inactivo'
      AND c.fecha_hora>clock_timestamp() AND c.fecha_hora<=clock_timestamp()+interval '24 hours'
      AND (r.id IS NULL OR (r.estado='fallido' AND r.intentos<3 AND r.actualizado_en<clock_timestamp()-interval '5 minutes'))
    ORDER BY c.fecha_hora LIMIT 100`);
}
export function textoRecordatorio(inicio) {
  const fecha = new Intl.DateTimeFormat("es-SV",{timeZone:"America/El_Salvador",dateStyle:"full",timeStyle:"short"}).format(new Date(inicio));
  return `Te recordamos tu cita en la clínica el ${fecha} (hora de El Salvador). Si necesitas cambiarla, ingresa a tu cuenta o contacta a recepción. Este mensaje no incluye información clínica.`;
}
// La entrega SMTP no es transaccional. Una respuesta ambigua se marca incierta y no se reenvía automáticamente.
export async function procesarRecordatorios(enviar) {
  const resumen={enviados:0,fallidos:0,inciertos:0,omitidos:0};
  await pool.query("UPDATE public.recordatorios SET estado='incierto',error_codigo='PROCESO_INTERRUMPIDO' WHERE estado='enviando' AND actualizado_en<clock_timestamp()-interval '10 minutes'");
  const candidatos=await candidatosRecordatorio();
  for(const candidato of candidatos.rows){
    const cliente=await pool.connect();let transaccion=false;
    try{
      const reclamado=await cliente.query(`INSERT INTO public.recordatorios(cita_id,inicio_cita,estado,intentos) VALUES($1,$2,'enviando',1)
        ON CONFLICT(cita_id,inicio_cita) DO UPDATE SET estado='enviando',intentos=recordatorios.intentos+1,actualizado_en=clock_timestamp(),error_codigo=NULL
        WHERE recordatorios.estado='fallido' AND recordatorios.intentos<3 AND recordatorios.actualizado_en<clock_timestamp()-interval '5 minutes'
        RETURNING id`,[candidato.id,candidato.inicio_exacto]);
      if(!reclamado.rowCount)continue;
      const id=reclamado.rows[0].id;
      await cliente.query("BEGIN");transaccion=true;
      await cliente.query("SET LOCAL lock_timeout='3s'");
      const actual=await cliente.query(`SELECT c.id,c.fecha_hora,COALESCE(u.email,p.email) AS email FROM public.citas c JOIN public.pacientes p ON p.id=c.paciente_id
        LEFT JOIN public.usuarios u ON u.id=p.usuario_id
        WHERE c.id=$1 AND c.fecha_hora=$2 AND c.estado='confirmada' AND p.estado<>'inactivo' AND c.fecha_hora>clock_timestamp() FOR SHARE OF c`,[candidato.id,candidato.inicio_exacto]);
      let estado="omitido",codigo=null;
      if(actual.rowCount && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actual.rows[0].email??"")){
        try{await enviar({to:actual.rows[0].email,subject:"Recordatorio de cita",text:textoRecordatorio(actual.rows[0].fecha_hora),messageId:`<cita-${id}@control-medico.local>`});estado="enviado";resumen.enviados++;}
        catch(error){
          codigo=["EAUTH","EENVELOPE","ECONNECTION","ETIMEDOUT","ESOCKET","EDNS","EMESSAGE"].includes(error.code)?error.code:"ERROR_SMTP";
          // Errores de autenticación/destinatario/DNS son anteriores a la entrega. Los demás requieren revisar al proveedor.
          estado=["EAUTH","EENVELOPE","EDNS"].includes(codigo)?"fallido":"incierto";
          if(estado==="fallido")resumen.fallidos++;else resumen.inciertos++;
        }
      }else{resumen.omitidos++;codigo=actual.rowCount?"SIN_CORREO_VALIDO":"CITA_CAMBIO";}
      await cliente.query("UPDATE public.recordatorios SET estado=$1,error_codigo=$2,actualizado_en=clock_timestamp() WHERE id=$3",[estado,codigo,id]);
      await cliente.query("COMMIT");transaccion=false;
    }catch(error){if(transaccion)await cliente.query("ROLLBACK").catch(()=>{});throw error;}
    finally{cliente.release();}
  }
  return resumen;
}
export async function crearEnvioSMTP(){
  if(process.env.RECORDATORIOS_ACTIVOS!=="true")throw new Error("Los recordatorios están desactivados.");
  for(const clave of ["SMTP_HOST","SMTP_USER","SMTP_PASSWORD","SMTP_FROM"]){if(!process.env[clave])throw new Error(`Falta configurar ${clave}.`);}
  const port=Number(process.env.SMTP_PORT??587);
  if(![465,587].includes(port))throw new Error("Usa SMTP_PORT 465 o 587 con TLS.");
  const {default:nodemailer}=await import("nodemailer");
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:true,
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,
    disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false});
  return async mensaje=>{
    const resultado=await transport.sendMail({...mensaje,from:process.env.SMTP_FROM});
    if(!resultado.accepted?.length){const error=new Error("El servidor no aceptó el destinatario.");error.code="EENVELOPE";throw error;}
  };
}
