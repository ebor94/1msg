'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick } = require('../src/workers/saludProveedor');

test('tick caído: registra down y reporta el detalle', async () => {
  let registrado = null;
  const r = await tick({
    verificarSalud: async () => ({ arriba: false, httpStatus: 500, detalle: 'HTTP 500' }),
    registrarSaludProveedor: async (arriba) => { registrado = arriba; return { cambio: true, antes: 'up', ahora: 'down' }; },
  });
  assert.equal(registrado, false);
  assert.equal(r.arriba, false);
  assert.equal(r.ahora, 'down');
  assert.equal(r.detalle, 'HTTP 500');
});

test('tick arriba: registra up', async () => {
  let registrado = null;
  const r = await tick({
    verificarSalud: async () => ({ arriba: true, httpStatus: 200, detalle: 'ok' }),
    registrarSaludProveedor: async (arriba) => { registrado = arriba; return { cambio: false, antes: 'up', ahora: 'up' }; },
  });
  assert.equal(registrado, true);
  assert.equal(r.arriba, true);
  assert.equal(r.ahora, 'up');
});
