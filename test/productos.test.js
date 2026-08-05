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

const { vistaPlanPrevision } = require('../src/controllers/productosController');

test('vistaPlanPrevision: oculta códigos/Fech ini/Anexo y muestra descripciones', () => {
  const estados = new Map([['3', 'Individual']]);
  const p = { num_plan: 100, concepto_plan: '49', concepto_desc: 'WhatsApp', estado_plan: 3, fech_ini_plan: '2025-01-01', anexo_plan: 'x', saldo_plan: 500 };
  const v = vistaPlanPrevision(p, estados);
  assert.equal(v.fech_ini_plan, undefined);
  assert.equal(v.anexo_plan, undefined);
  assert.equal(v.concepto_plan, undefined);
  assert.equal(v.estado_plan, undefined);
  assert.equal(v.Concepto, 'WhatsApp');
  assert.equal(v.Estado, 'Individual');
  assert.equal(v.num_plan, 100);
  assert.equal(v.saldo_plan, 500);
});

test('vistaPlanPrevision: estado sin match → deja el código', () => {
  assert.equal(vistaPlanPrevision({ estado_plan: 99 }, new Map()).Estado, 99);
});
