import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import express from "express";
import bcrypt from "bcrypt";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
// Base efímera independiente: nunca sembrar pruebas en control_medico.
const nombre = `control_medico_test_${process.pid}_${Date.now()}`;
const mantenimiento = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionTimeoutMillis: 5000 });
let creada = false, pool, servidor;
let comprobaciones = 0;
function comprobar(condicion, mensaje) { assert.ok(condicion, mensaje); comprobaciones++; console.log(`OK ${comprobaciones}: ${mensaje}`); }
try {
  assert.match(nombre, /^control_medico_test_\d+_\d+$/);
  await mantenimiento.query(`CREATE DATABASE "${nombre}"`);
  creada = true;
  process.env.DB_NAME = nombre;
  ({ pool } = await import("../config/db.js"));
  for (const archivo of ["01_crear_tablas.sql", "02_tratamientos_iniciales.sql", "03_actualizar_pagos.sql", "04_reservas_pacientes.sql", "05_administracion.sql"]) {
    const sql = (await readFile(new URL(`../../../database/${archivo}`, import.meta.url), "utf8")).replaceAll("'control_medico'", `'${nombre}'`);
    await pool.query(sql);
  }
  const app = express(); app.use(express.json());
  for (const [ruta, archivo] of [["auth", "auth"], ["pacientes", "pacientes"], ["doctores", "doctores"], ["agenda", "agenda"], ["historial", "historial"], ["cobros", "cobros"], ["dashboard", "dashboard"], ["agenda-doctor", "agenda-doctor"], ["reportes", "reportes"], ["usuarios","usuarios"], ["auditoria","auditoria"], ["recordatorios","recordatorios"]]) {
    app.use(`/api/${ruta}`, (await import(`../routes/${archivo}.routes.js`)).default);
  }
  app.use((error, req, res, next) => { console.error("Fallo API de prueba:", error.code ?? error.message); res.status(500).json({ correcto: false }); });
  if (process.argv.includes("--visual")) app.use(express.static(fileURLToPath(new URL("../../../frontend/dist/", import.meta.url))));
  servidor = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  async function api(ruta, token, cuerpo, method = "POST") {
    const respuesta = await fetch(base + "/api" + ruta, { method: cuerpo === undefined ? "GET" : method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(12000) });
    return { status: respuesta.status, ...(await respuesta.json()) };
  }
  const password = process.argv.includes("--visual") ? "PruebaVisualTemporal_2026!" : randomBytes(24).toString("hex");
  const hash = await bcrypt.hash(password, 12);
  for (const rol of ["admin", "recepcionista"]) await pool.query("INSERT INTO public.usuarios (nombre,email,password_hash,rol) VALUES ($1,$2,$3,$1)", [rol, `${rol}@prueba.invalid`, hash]);
  const admin = (await api("/auth/login", null, { email: "admin@prueba.invalid", password })).token;
  const recepcion = (await api("/auth/login", null, { email: "recepcionista@prueba.invalid", password })).token;
  comprobar(Boolean(admin && recepcion), "Login real de administrador y recepción");
  comprobar((await api("/agenda/doctores")).status === 401, "API rechaza solicitudes sin sesión");
  const creado = await api("/doctores", admin, { nombre: "Doctor prueba", email: "doctor@prueba.invalid", password, especialidad: "General", licencia: "TEST-001", telefono: "22222222", dias: [1,2,3,4,5,6,7], hora_inicio: "08:00", hora_fin: "17:00" });
  comprobar(creado.status === 201, "Crear doctor y horario mediante API");
  const doctor = creado.doctor;
  const tokenDoctor = (await api("/auth/login", null, { email: "doctor@prueba.invalid", password })).token;
  const fichas = [];
  for (let n = 0; n < 3; n++) {
    const alta = await api("/pacientes", recepcion, { nombre: `Paciente prueba ${n}`, fecha_nacimiento: "1990-01-01", telefono: "22222222", email: `paciente${n}@prueba.invalid`, direccion: "", antecedentes: "" });
    comprobar(alta.status === 201, `Crear ficha ${n}`);
    fichas.push(alta.paciente);
    const cuenta = await api(`/pacientes/${alta.paciente.id}/cuenta`, recepcion, { email: `paciente${n}@prueba.invalid`, password });
    comprobar(cuenta.status === 201, `Vincular cuenta a ficha ${n}`);
    alta.paciente.token = (await api("/auth/login", null, { email: `paciente${n}@prueba.invalid`, password })).token;
  }
  const p = fichas[0], otro = fichas[1];
  comprobar((await api(`/pacientes/${p.id}/cuenta`, admin, { email: "duplicado@prueba.invalid", password })).status === 409, "Una ficha no recibe dos cuentas");
  comprobar((await api("/pacientes", p.token)).status === 403, "Paciente no puede consultar fichas ajenas");
  comprobar((await api("/doctores", recepcion)).status === 403, "Recepción no administra doctores");
  comprobar((await api("/agenda/doctores", tokenDoctor)).status === 403, "Doctor no accede a agenda administrativa");
  const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
  const reserva = { doctor_id: doctor.id, paciente_id: otro.id, fecha, hora: "09:00", duracion: 30, motivo: "Consulta de prueba", importe_total: "999" };
  const altaCita = await api("/agenda/citas", p.token, reserva);
  comprobar(altaCita.status === 201, "Paciente reserva un horario disponible");
  const cita = altaCita.cita;
  const guardada = (await pool.query("SELECT * FROM public.citas WHERE id=$1", [cita.id])).rows[0];
  comprobar(guardada.paciente_id === p.id && guardada.importe_pendiente && guardada.importe_total === "0.00", "Identidad y precio del paciente enviados por el cliente no se aceptan");
  comprobar((await api("/agenda/mis-citas", otro.token)).citas.length === 0, "Paciente no ve citas ajenas");
  comprobar((await api(`/agenda/citas/${cita.id}/disponibilidad?fecha=${fecha}&duracion=30`, otro.token)).status === 404, "No se filtra disponibilidad de citas ajenas");
  comprobar((await api(`/agenda/citas/${cita.id}/estado`, otro.token, { estado: "cancelada", motivo_cancelacion: "Intento ajeno" }, "PATCH")).status === 409, "No se permite cancelar una cita ajena");
  comprobar((await api(`/agenda/citas/${cita.id}/estado`, p.token, { estado: "confirmada" }, "PATCH")).status === 403, "Paciente no confirma ni establece precio");
  comprobar((await api(`/agenda/citas/${cita.id}/estado`, recepcion, { estado: "confirmada" }, "PATCH")).status === 409, "Confirmación exige importe cuando está pendiente");
  comprobar((await api(`/agenda/citas/${cita.id}/estado`, recepcion, { estado: "confirmada", importe_total: "25.50" }, "PATCH")).status === 200, "Recepción confirma y asigna el importe");
  const confirmada = (await api("/agenda/mis-citas", p.token)).citas[0];
  comprobar(confirmada.importe_total === "25.50" && !confirmada.importe_pendiente, "Importe confirmado persiste en la cuenta del paciente");
  const reprogramacion = { fecha, hora: "10:00", duracion: 30, fecha_hora_original: confirmada.fecha_hora, fecha_hora_fin_original: confirmada.fecha_hora_fin, estado_original: confirmada.estado };
  comprobar((await api(`/agenda/citas/${cita.id}/reprogramar`, otro.token, reprogramacion, "PATCH")).status === 404, "Paciente no reprograma citas ajenas");
  comprobar((await api(`/agenda/citas/${cita.id}/reprogramar`, p.token, reprogramacion, "PATCH")).status === 200, "Paciente reprograma su cita");
  comprobar((await api(`/agenda/citas/${cita.id}/reprogramar`, p.token, reprogramacion, "PATCH")).status === 409, "Reprogramación detecta una versión desactualizada");
  let originales = doctor.horarios;
  const sinManana = originales.map(h => ({ ...h, hora_inicio: "12:00" }));
  comprobar((await api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: sinManana }, "PUT")).status === 409, "Horario no puede dejar una cita vigente fuera");
  const recortados = originales.map(h => ({ ...h, hora_fin: "10:15" }));
  comprobar((await api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: recortados }, "PUT")).status === 409, "Horario valida el final de la cita, no solo el inicio");
  comprobar((await api(`/doctores/${doctor.id}/horarios`, p.token, { originales, horarios: originales }, "PUT")).status === 403, "Paciente no modifica horarios");
  const partidos = originales.flatMap(h => [{ ...h, hora_fin: "12:00" }, { ...h, hora_inicio: "14:00" }]);
  comprobar((await api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: partidos }, "PUT")).status === 200, "Guardar jornadas partidas conservando citas");
  comprobar((await api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: originales }, "PUT")).status === 409, "Horario detecta edición desactualizada");
  originales = partidos;
  comprobar((await api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: [...partidos, partidos[0]] }, "PUT")).status === 400, "Se rechazan intervalos superpuestos");
  const disponibles = await api(`/agenda/disponibilidad?doctor_id=${doctor.id}&fecha=${fecha}&duracion=60`, p.token);
  comprobar(!disponibles.horarios.some(h => h.hora === "11:15" || h.hora === "13:00"), "La duración completa respeta el descanso entre intervalos");
  const carreras = await Promise.all([otro, fichas[2]].map(f => api("/agenda/citas", f.token, { ...reserva, hora: "14:00" })));
  comprobar(carreras.filter(r => r.status === 201).length === 1 && carreras.filter(r => r.status === 409).length === 1, "Dos reservas simultáneas: solo una obtiene el horario");
  const competencia = await Promise.all([
    api(`/doctores/${doctor.id}/horarios`, admin, { originales, horarios: partidos.map(h => h.hora_inicio === "14:00" ? { ...h, hora_fin: "15:00" } : h) }, "PUT"),
    api("/agenda/citas", p.token, { ...reserva, hora: "16:00" })
  ]);
  comprobar(competencia.some(r => r.status === 409) && competencia.some(r => r.status === 200 || r.status === 201), "Cambiar horario y reservar simultáneamente conserva la coherencia");
  comprobar((await api(`/agenda/citas/${cita.id}/estado`, p.token, { estado: "cancelada", motivo_cancelacion: "Ya no puedo asistir" }, "PATCH")).status === 200, "Paciente cancela su propia cita");
  // Hora pasada únicamente en esta base efímera, para probar atención sin esperar una cita real.
  const pasada = (await pool.query(`INSERT INTO public.citas (paciente_id,doctor_id,fecha_hora,fecha_hora_fin,motivo,estado,importe_total)
    VALUES ($1,$2,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour','Prueba clínica','confirmada',30) RETURNING id`, [p.id,doctor.id])).rows[0];
  const tratamiento = (await pool.query("SELECT id FROM public.tratamientos WHERE activo LIMIT 1")).rows[0].id;
  const atencion = { cita_id: pasada.id, tratamiento_id: tratamiento, diagnostico: "Diagnóstico de prueba", indicaciones: "Indicaciones de prueba", notas: "" };
  comprobar((await api("/historial/atenciones", recepcion, atencion)).status === 403, "Recepción no registra diagnósticos");
  comprobar((await api("/historial/atenciones", tokenDoctor, atencion)).status === 201, "Doctor asignado registra atención y completa la cita");
  comprobar((await api("/historial/atenciones", tokenDoctor, atencion)).status === 409, "No se duplica una atención clínica");
  const pago = { cita_id: pasada.id, monto: "10.00", metodo_pago: "efectivo", clave_operacion: randomUUID() };
  comprobar((await api("/cobros/pagos", p.token, pago)).status === 403, "Paciente no registra cobros");
  const primerPago = await api("/cobros/pagos", recepcion, pago);
  comprobar(primerPago.status === 201, "Recepción registra abono parcial");
  const repetido = await api("/cobros/pagos", recepcion, pago);
  comprobar(repetido.status === 200 && repetido.pago_id === primerPago.pago_id, "Reintentar el pago no duplica el abono");
  const pagos = await Promise.all([0,1].map(() => api("/cobros/pagos", recepcion, { ...pago, monto: "20.00", clave_operacion: randomUUID() })));
  comprobar(pagos.filter(r => r.status === 201).length === 1 && pagos.filter(r => r.status === 409).length === 1, "Cobros simultáneos no superan el saldo");
  const totalPagado = (await pool.query("SELECT sum(monto)::text AS total FROM public.pagos WHERE cita_id=$1", [pasada.id])).rows[0].total;
  comprobar(totalPagado === "30.00", "Los pagos persistidos liquidan exactamente el importe");
  comprobar((await api(`/historial/pacientes/${p.id}`, tokenDoctor)).status === 200, "Doctor consulta el historial después de guardar");
  comprobar((await api(`/historial/pacientes/${p.id}`, recepcion)).status === 403, "Recepción no puede leer el historial clínico");
  const fechaPago = (await pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'America/El_Salvador','YYYY-MM-DD') AS fecha")).rows[0].fecha;
  const reporte = await api(`/reportes?desde=${fechaPago}&hasta=${fechaPago}&doctor_id=${doctor.id}`, recepcion);
  comprobar(reporte.status === 200 && reporte.doctores[0].ingresos === "30.00" && reporte.doctores[0].pagos === 2, "Reporte suma pagos sin duplicar importes y filtra por doctor");
  const sinIngresos = await api(`/reportes?desde=${fecha}&hasta=${fecha}`, admin);
  comprobar(sinIngresos.status === 200 && sinIngresos.doctores.every(d => d.ingresos === "0.00"), "Reporte diferencia fecha de pago de fecha de cita");
  comprobar((await api(`/reportes?desde=${fechaPago}&hasta=${fechaPago}`, p.token)).status === 403, "Paciente no consulta reportes de ingresos");
  comprobar((await api("/reportes?desde=2026-02-30&hasta=2026-03-01", admin)).status === 400, "Reporte rechaza fechas inexistentes");
  comprobar((await api("/reportes?desde=2026-03-02&hasta=2026-03-01", admin)).status === 400, "Reporte rechaza rangos invertidos");
  comprobar((await api("/dashboard", admin)).status === 200, "Dashboard administrativo responde");
  comprobar((await api(`/agenda-doctor?fecha=${fecha}`, tokenDoctor)).status === 200, "Agenda personal del doctor responde");
  const datosDoctor = { nombre: "Doctor editado", email: "doctor-editado@prueba.invalid", telefono: "22223333", especialidad: "Medicina general", licencia: "TEST-002" };
  comprobar((await api(`/doctores/${doctor.id}`, admin, datosDoctor, "PUT")).status === 200, "Editar datos del doctor desde la API");
  comprobar(Boolean((await api("/auth/login", null, { email: datosDoctor.email, password })).token), "Cambio de correo conserva contraseña y permite iniciar sesión");
  comprobar((await api("/usuarios", p.token)).status === 403, "Paciente no administra cuentas");
  comprobar((await api("/usuarios", recepcion)).status === 403, "Recepción no administra cuentas");
  const recepNueva=await api("/usuarios",admin,{nombre:"Recepción nueva",email:"nueva@prueba.invalid",telefono:"22222222",password});
  comprobar(recepNueva.status===201,"Administrador crea una cuenta de recepción");
  comprobar((await api(`/usuarios/${recepNueva.id}`,admin,{nombre:"Recepción editada",email:"nueva-editada@prueba.invalid",telefono:"22223333"},"PUT")).status===200,"Administrador edita recepción");
  const loginRecep=(await api("/auth/login",null,{email:"nueva-editada@prueba.invalid",password})).token;
  comprobar(Boolean(loginRecep),"Cuenta de recepción editada puede iniciar sesión");
  comprobar((await api(`/usuarios/${recepNueva.id}/estado`,admin,{activo:false},"PATCH")).status===200,"Administrador desactiva recepción");
  comprobar((await api("/auth/me",loginRecep)).status===401,"Desactivar cuenta revoca la sesión");
  await api(`/usuarios/${recepNueva.id}/estado`,admin,{activo:true},"PATCH");
  comprobar((await api("/auth/me",loginRecep)).status===401,"Reactivar no revive tokens antiguos");
  comprobar((await api(`/doctores/${doctor.id}/estado`,admin,{activo:false},"PATCH")).status===409,"No desactiva doctor con citas vigentes");
  await pool.query("UPDATE public.citas SET estado='cancelada',motivo_cancelacion='Fin de escenario de pruebas' WHERE doctor_id=$1 AND estado IN ('pendiente','confirmada')",[doctor.id]);
  comprobar((await api(`/doctores/${doctor.id}/estado`,admin,{activo:false},"PATCH")).status===200,"Desactiva doctor sin citas vigentes");
  comprobar((await api("/auth/me",tokenDoctor)).status===401,"Desactivar doctor cierra sus sesiones");
  comprobar((await api("/agenda/citas",p.token,{...reserva,hora:"08:00"})).status===404,"No reserva con doctor inactivo");
  comprobar((await api(`/doctores/${doctor.id}/estado`,admin,{activo:true},"PATCH")).status===200,"Reactiva doctor conservando sus horarios");
  const proxima=await api("/agenda/citas",p.token,{...reserva,hora:"08:00"});
  comprobar(proxima.status===201,"Doctor reactivado vuelve a recibir reservas");
  const proximas=await api("/agenda/mis-citas?grupo=proximas",p.token);
  const anteriores=await api("/agenda/mis-citas?grupo=anteriores",p.token);
  comprobar(proximas.citas.every(c=>['pendiente','confirmada'].includes(c.estado)) && anteriores.citas.every(c=>['cancelada','completada'].includes(c.estado)),"Filtros de próximas y anteriores separan los resultados");
  comprobar((await api(`/usuarios/${recepNueva.id}/recuperacion`,admin,{password_admin:"incorrecta"})).status===400,"Recuperación exige reautenticación de administrador");
  const recuperacion=await api(`/usuarios/${recepNueva.id}/recuperacion`,admin,{password_admin:password});
  comprobar(recuperacion.status===200 && recuperacion.codigo.length===64,"Genera recuperación de un solo uso");
  const almacenado=(await pool.query("SELECT codigo_hash FROM public.recuperaciones WHERE usuario_id=$1 ORDER BY id DESC LIMIT 1",[recepNueva.id])).rows[0];
  comprobar(almacenado.codigo_hash!==recuperacion.codigo,"No almacena el código de recuperación en texto claro");
  const nuevaPassword=randomBytes(24).toString("hex");
  comprobar((await api("/auth/recuperar",null,{codigo:recuperacion.codigo,nueva:nuevaPassword})).status===200,"Restablece contraseña con código válido");
  comprobar((await api("/auth/recuperar",null,{codigo:recuperacion.codigo,nueva:password})).status===400,"Código de recuperación no puede reutilizarse");
  const recuperada=(await api("/auth/login",null,{email:"nueva-editada@prueba.invalid",password:nuevaPassword})).token;
  comprobar(Boolean(recuperada),"Nueva contraseña recuperada permite iniciar sesión");
  comprobar((await api("/auth/password",recuperada,{actual:"incorrecta",nueva:password})).status===400,"Cambio de contraseña rechaza contraseña actual incorrecta");
  comprobar((await api("/auth/password",recuperada,{actual:nuevaPassword,nueva:password})).status===200,"Usuario cambia su contraseña desde la aplicación");
  comprobar((await api("/auth/me",recuperada)).status===401,"Cambio de contraseña invalida el token anterior");
  const vencida=await api(`/usuarios/${recepNueva.id}/recuperacion`,admin,{password_admin:password});
  await pool.query("UPDATE public.recuperaciones SET vence_en=clock_timestamp()-interval '1 minute' WHERE usuario_id=$1",[recepNueva.id]);
  comprobar((await api("/auth/recuperar",null,{codigo:vencida.codigo,nueva:nuevaPassword})).status===400,"Recuperación rechaza códigos vencidos");
  const eventos=await api("/auditoria",admin);
  comprobar(eventos.status===200 && eventos.eventos.length>0,"Registro de acciones disponible para administrador");
  const auditoria=(await pool.query("SELECT accion FROM public.auditoria")).rows.map(e=>e.accion);
  comprobar(["crear_cita","reprogramar_cita","cancelar_cita","editar_horarios","registrar_pago","cambiar_password","recuperar_password"].every(a=>auditoria.includes(a)),"Auditoría cubre citas, horarios, cobros y seguridad");
  comprobar((await api("/auditoria",recepcion)).status===403,"Recepción no consulta auditoría");
  const {procesarRecordatorios}=await import("../services/recordatorios.js");
  const recordatorio=(await pool.query(`INSERT INTO public.citas(paciente_id,doctor_id,fecha_hora,fecha_hora_fin,motivo,estado,importe_total)
    VALUES($1,$2,clock_timestamp()+interval '23 hours',clock_timestamp()+interval '23 hours 30 minutes','Prueba recordatorio','confirmada',20) RETURNING id`,[p.id,doctor.id])).rows[0];
  let enviosSimulados=0;
  const transportePrueba=async mensaje=>{assert.ok(!mensaje.text.includes("Diagnóstico"));enviosSimulados++;};
  await Promise.all([procesarRecordatorios(transportePrueba),procesarRecordatorios(transportePrueba)]);
  comprobar(enviosSimulados===1,"Dos procesos de recordatorios reclaman una cita una sola vez (transporte simulado)");
  await procesarRecordatorios(transportePrueba);
  comprobar(enviosSimulados===1,"Recordatorio ya enviado no se repite");
  await pool.query("UPDATE public.citas SET fecha_hora=fecha_hora+interval '10 minutes',fecha_hora_fin=fecha_hora_fin+interval '10 minutes' WHERE id=$1",[recordatorio.id]);
  await procesarRecordatorios(async()=>{const e=new Error("Prueba timeout");e.code="ETIMEDOUT";throw e;});
  await procesarRecordatorios(transportePrueba);
  const inciertos=(await pool.query("SELECT count(*)::int AS total FROM public.recordatorios WHERE estado='incierto'")).rows[0].total;
  comprobar(inciertos===1 && enviosSimulados===1,"Respuesta SMTP incierta no causa reenvíos automáticos");
  comprobar((await api("/recordatorios",admin)).status===200 && (await api("/recordatorios",p.token)).status===403,"Estado de recordatorios respeta permisos");
  console.log(`Verificación finalizada: ${comprobaciones} comprobaciones correctas.`);
  if (process.argv.includes("--visual")) {
    console.log(`Entorno visual temporal: ${base}. Se cerrará automáticamente en diez minutos.`);
    await new Promise(resolve => setTimeout(resolve, 600000));
  }
} finally {
  if (servidor) await new Promise(resolve => servidor.close(resolve));
  if (pool) await pool.end();
  if (creada) { assert.match(nombre, /^control_medico_test_\d+_\d+$/); await mantenimiento.query(`DROP DATABASE "${nombre}"`); console.log("Base de pruebas eliminada; datos reales intactos."); }
  await mantenimiento.end();
}
