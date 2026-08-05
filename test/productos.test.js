'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seguro } = require('../src/controllers/productosController');

test('seguro: éxito → estado ok con datos', async () => {
  const r = await seguro(async () => [{ a: 1 }], '123');
  assert.deepEqual(r, { estado: 'ok', datos: [{ a: 1 }] });
});

test('seguro: no_configurado → estado no_configurado', async () => {
  const r = await seguro(async () => { const e = new Error('x'); e.codigo = 'no_configurado'; throw e; }, '123');
  assert.deepEqual(r, { estado: 'no_configurado' });
});

test('seguro: otro error → estado error (no lanza)', async () => {
  const r = await seguro(async () => { throw new Error('boom'); }, '123');
  assert.deepEqual(r, { estado: 'error' });
});
