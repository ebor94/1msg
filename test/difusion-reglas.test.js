'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dentroDeVentana, esperaEnvioMs, clasificarError } = require('../src/services/difusionReglas');

// 2026-08-03 = Lunes, 08-08 = Sábado, 08-09 = Domingo (verificado).
test('dentroDeVentana: Lun 10h sí, Lun 07h no, Lun 19h no', () => {
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 10, 0)), true);
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 7, 59)), false);
  assert.equal(dentroDeVentana(new Date(2026, 7, 3, 19, 0)), false);
});
test('dentroDeVentana: Sáb 12h sí, Sáb 14h no, Dom no', () => {
  assert.equal(dentroDeVentana(new Date(2026, 7, 8, 12, 0)), true);
  assert.equal(dentroDeVentana(new Date(2026, 7, 8, 14, 0)), false);
  assert.equal(dentroDeVentana(new Date(2026, 7, 9, 10, 0)), false);
});
test('esperaEnvioMs: base + jitter según rnd', () => {
  assert.equal(esperaEnvioMs(20000, 5000, () => 0), 20000);
  assert.equal(esperaEnvioMs(20000, 5000, () => 0.9998), 24999);
});
test('clasificarError: 131049→24h, 130472→omitido+experimento, otro→fallido', () => {
  assert.deepEqual(clasificarError('131049'), { estado: 'fallido', reintentarEnMin: 1440, marcarExperimento: false });
  assert.deepEqual(clasificarError('130472'), { estado: 'omitido', reintentarEnMin: null, marcarExperimento: true });
  assert.deepEqual(clasificarError('131000'), { estado: 'fallido', reintentarEnMin: null, marcarExperimento: false });
});
