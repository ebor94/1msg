'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearFecha, percentil, agregarTpr } = require('../src/services/reporteAgentes');

test('parsearFecha válida arma ini/fin del día', () => {
  const r = parsearFecha('2026-08-03');
  assert.equal(r.fecha, '2026-08-03');
  assert.equal(r.ini, '2026-08-03 00:00:00');
  assert.equal(r.fin, '2026-08-04 00:00:00');
});
test('parsearFecha sin argumento no lanza y da un día válido', () => {
  const r = parsearFecha();
  assert.match(r.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.fin, /^\d{4}-\d{2}-\d{2} 00:00:00$/);
});
test('parsearFecha inválida lanza 400', () => {
  assert.throws(() => parsearFecha('03/08/2026'), (e) => e.status === 400);
});
test('percentil P90 de una lista', () => {
  const ord = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentil(ord, 90), 9);
  assert.equal(percentil([], 90), null);
});
test('agregarTpr agrupa por agente y calcula prom/P90/turnos', () => {
  // Lun 2026-08-03: dos turnos del agente 7 (10 y 20 min) y uno del 9 (5 min).
  const turnos = [
    { agenteId: 7, clienteTs: '2026-08-03 08:00:00', agenteTs: '2026-08-03 08:10:00' },
    { agenteId: 7, clienteTs: '2026-08-03 09:00:00', agenteTs: '2026-08-03 09:20:00' },
    { agenteId: 9, clienteTs: '2026-08-03 10:00:00', agenteTs: '2026-08-03 10:05:00' },
  ];
  const m = agregarTpr(turnos);
  assert.equal(m.get(7).tprPromMin, 15);
  assert.equal(m.get(7).turnos, 2);
  assert.equal(m.get(9).tprPromMin, 5);
  assert.equal(m.get(9).turnos, 1);
});
