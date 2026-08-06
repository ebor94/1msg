'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Recordatorio, Ajuste } = require('../src/models');
const { ORIGEN_CONVERSACION } = require('../src/config/constants');

test('Recordatorio tiene los campos clave', () => {
  for (const c of ['contactoId', 'diaMes', 'activo', 'ultimoEnvioEn', 'agenteId']) {
    assert.ok(Recordatorio.rawAttributes[c], `falta ${c}`);
  }
});
test('Ajuste tiene clave/valor', () => {
  assert.ok(Ajuste.rawAttributes.clave && Ajuste.rawAttributes.valor);
});
test('ORIGEN_CONVERSACION.RECORDATORIO existe', () => {
  assert.equal(ORIGEN_CONVERSACION.RECORDATORIO, 'recordatorio');
});
