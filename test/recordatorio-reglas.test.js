'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diasDelMes, esDiaDeEnvio } = require('../src/services/recordatorioReglas');

test('diasDelMes', () => {
  assert.equal(diasDelMes(2026, 2), 28);
  assert.equal(diasDelMes(2024, 2), 29);
  assert.equal(diasDelMes(2026, 4), 30);
  assert.equal(diasDelMes(2026, 1), 31);
});
test('esDiaDeEnvio: coincide el día', () => {
  assert.equal(esDiaDeEnvio(5, 5, 31), true);
  assert.equal(esDiaDeEnvio(5, 6, 31), false);
});
test('esDiaDeEnvio: día 30 en febrero cae el último día', () => {
  assert.equal(esDiaDeEnvio(30, 28, 28), true);  // feb 28 = último día, objetivo 30 no existe
  assert.equal(esDiaDeEnvio(30, 27, 28), false);
  assert.equal(esDiaDeEnvio(30, 30, 31), true);  // en un mes de 31, el 30 es normal
});
