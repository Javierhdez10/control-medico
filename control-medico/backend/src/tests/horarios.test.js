import test from "node:test";
import assert from "node:assert/strict";
import { validarHorarios } from "../services/horarios.js";
const bloque = (dia, inicio, fin) => ({ dia_semana: dia, hora_inicio: inicio, hora_fin: fin });
test("Conserva jornadas partidas y ordena sin modificar la entrada", () => {
  const entrada = [bloque(1,"14:00","17:00"),bloque(1,"08:00","12:00")];
  const resultado = validarHorarios(entrada);
  assert.equal(resultado.length,2); assert.equal(resultado[0].hora_inicio,"08:00"); assert.equal(entrada[0].hora_inicio,"14:00");
});
test("Rechaza cruces, duplicados, horas incorrectas y días inválidos", () => {
  for (const valor of [null, {}, [bloque(0,"08:00","09:00")], [bloque(8,"08:00","09:00")], [bloque(1,"24:00","25:00")], [bloque(1,"8:00","09:00")], [bloque(1,"08:00","08:00")], [bloque(1,"12:00","09:00")], [bloque(1,"08:00","12:00"), bloque(1,"11:00","13:00")], [bloque(1,"08:00","12:00"), bloque(1,"08:00","12:00")]]) {
    assert.throws(() => validarHorarios(valor), { status: 400 });
  }
});
test("Acepta intervalos contiguos, diferentes días y semana sin intervalos", () => {
  assert.equal(validarHorarios([bloque(1,"08:00","12:00"), bloque(1,"12:00","16:00"), bloque(2,"08:00","12:00")]).length,3);
  assert.deepEqual(validarHorarios([]),[]);
});
