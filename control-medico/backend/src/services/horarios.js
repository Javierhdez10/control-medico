export function validarHorarios(valor) {
  const fallo = (mensaje) => { const error = new Error(mensaje); error.status = 400; throw error; };
  if (!Array.isArray(valor) || valor.length > 56) fallo("Envía un máximo de 56 intervalos semanales.");
  const horarios = valor.map(h => {
    if (!h || !Number.isInteger(h.dia_semana) || h.dia_semana < 1 || h.dia_semana > 7 ||
        typeof h.hora_inicio !== "string" || typeof h.hora_fin !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora_inicio) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora_fin) || h.hora_inicio >= h.hora_fin) {
      fallo("Revisa los días y las horas: cada intervalo debe terminar después de comenzar.");
    }
    return { dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fin: h.hora_fin };
  }).sort((a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio));
  for (let i = 1; i < horarios.length; i++) {
    if (horarios[i].dia_semana === horarios[i - 1].dia_semana && horarios[i].hora_inicio < horarios[i - 1].hora_fin) {
      fallo("Los intervalos del mismo día no pueden superponerse.");
    }
  }
  return horarios;
}
