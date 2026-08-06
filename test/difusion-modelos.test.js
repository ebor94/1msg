'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Difusion, DifusionDestinatario } = require('../src/models');

test('DifusionDestinatario tiene agenteId', () => {
  assert.ok(DifusionDestinatario.rawAttributes.agenteId, 'falta agenteId');
});
test('Difusion tiene imagenUrl', () => {
  assert.ok(Difusion.rawAttributes.imagenUrl, 'falta imagenUrl');
});
