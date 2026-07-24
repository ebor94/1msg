'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firmar, verificar } = require('../src/utils/jwt');

test('firmar y verificar devuelve el payload', () => {
  const token = firmar({ id: 1, rol: 'administrador' });
  const dec = verificar(token);
  assert.equal(dec.id, 1);
  assert.equal(dec.rol, 'administrador');
});

test('verificar lanza con token inválido', () => {
  assert.throws(() => verificar('no-es-un-token'));
});
