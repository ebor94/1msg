'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dentroDeVentana, esperaEnvioMs, clasificarError } = require('../src/services/difusionReglas');

// Colombia = UTC-5, así que Colombia HH:00 = UTC (HH+5):00. 2026-08-03 Lun, 08-08 Sáb, 08-09 Dom.
test('dentroDeVentana: Lun 10h sí, 07:59 no, 19h no (hora Colombia)', () => {
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 3, 15, 0))), true);   // Lun 10:00 CO
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 3, 12, 59))), false); // Lun 07:59 CO
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 4, 0, 0))), false);   // Lun 19:00 CO
});
test('dentroDeVentana: Sáb 12h sí, Sáb 14h no, Dom no (hora Colombia)', () => {
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 8, 17, 0))), true);   // Sáb 12:00 CO
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 8, 19, 0))), false);  // Sáb 14:00 CO
  assert.equal(dentroDeVentana(new Date(Date.UTC(2026, 7, 9, 15, 0))), false);  // Dom 10:00 CO
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
