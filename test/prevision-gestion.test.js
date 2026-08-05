'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decidirMasivo, debeRegistrarGestion } = require('../src/integrations/prevision/cliente');

test('decidirMasivo: true solo con posfecha Y concepto permitido', () => {
  assert.equal(decidirMasivo('2026-08-10', true), true);
  assert.equal(decidirMasivo('2026-08-10', false), false); // no permitido
  assert.equal(decidirMasivo(null, true), false);          // sin posfecha
  assert.equal(decidirMasivo('', true), false);
});

test('debeRegistrarGestion: false para concepto 5, true para el resto', () => {
  assert.equal(debeRegistrarGestion('5'), false);
  assert.equal(debeRegistrarGestion(5), false);
  assert.equal(debeRegistrarGestion('49'), true);
  assert.equal(debeRegistrarGestion('1'), true);
});
