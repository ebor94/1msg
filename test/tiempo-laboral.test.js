'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { minutosLaborales } = require('../src/services/tiempoLaboral');

// Fechas ancla (verificadas): 2026-08-03 Lun, 08-04 Mar, 08-08 Sáb, 08-09 Dom, 08-10 Lun.
test('mismo tramo, dentro de la franja (Lun)', () => {
  assert.equal(minutosLaborales('2026-08-03 08:10:00', '2026-08-03 08:25:00'), 15);
});
test('franja completa de un día hábil', () => {
  assert.equal(minutosLaborales('2026-08-03 08:00:00', '2026-08-03 18:00:00'), 600);
});
test('cruza la noche: solo cuenta horario hábil de cada día', () => {
  // Lun 17:55→18:00 = 5, Mar 08:00→08:05 = 5
  assert.equal(minutosLaborales('2026-08-03 17:55:00', '2026-08-04 08:05:00'), 10);
});
test('cruza fin de semana: sábado corto + domingo cero + lunes', () => {
  // Sáb 10:30→11:00 = 30, Dom 0, Lun 08:00→08:30 = 30
  assert.equal(minutosLaborales('2026-08-08 10:30:00', '2026-08-10 08:30:00'), 60);
});
test('domingo entero = 0', () => {
  assert.equal(minutosLaborales('2026-08-09 09:00:00', '2026-08-09 10:00:00'), 0);
});
test('fuera de horario (noche) = 0', () => {
  assert.equal(minutosLaborales('2026-08-03 19:00:00', '2026-08-03 20:00:00'), 0);
});
test('respuesta anterior o igual al inicio = 0', () => {
  assert.equal(minutosLaborales('2026-08-03 09:00:00', '2026-08-03 09:00:00'), 0);
  assert.equal(minutosLaborales('2026-08-03 10:00:00', '2026-08-03 09:00:00'), 0);
});
