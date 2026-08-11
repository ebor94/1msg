'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { procesarPendiente } = require('../src/services/resumenDifusiones');

function deps(over = {}) {
  const calls = { insert: [], marcar: [], resumir: 0 };
  const base = {
    construirTexto: async () => ({ texto: 'Enviado: x\nCliente: pago el viernes', huboRespuesta: true }),
    resumir: async () => { calls.resumir++; return 'Cliente pagará el viernes.'; },
    consultarPlanes: async () => [{ num_plan: 111 }],
    insertarGestion: async (g) => { calls.insert.push(g); },
    marcar: async (id) => { calls.marcar.push(id); },
  };
  return { d: { ...base, ...over }, calls };
}

test('con respuesta: resume, inserta gestión (concepto 49, tramito IA) y marca', async () => {
  const { d, calls } = deps();
  const r = await procesarPendiente({ id: 7, documento: '88123456' }, d);
  assert.equal(r, 'resumido');
  assert.equal(calls.resumir, 1);
  assert.deepEqual(calls.insert[0], { numPlan: 111, concepto: '49', novedad: 'Cliente pagará el viernes.', tramito: 'IA' });
  assert.deepEqual(calls.marcar, [7]);
});

test('sin respuesta: no llama a la IA, novedad "Sin respuesta del cliente"', async () => {
  const { d, calls } = deps({ construirTexto: async () => ({ texto: '', huboRespuesta: false }) });
  const r = await procesarPendiente({ id: 8, documento: '88123456' }, d);
  assert.equal(r, 'resumido');
  assert.equal(calls.resumir, 0);
  assert.equal(calls.insert[0].novedad, 'Sin respuesta del cliente');
});

test('sin plan para la cédula: marca y no inserta', async () => {
  const { d, calls } = deps({ consultarPlanes: async () => [] });
  const r = await procesarPendiente({ id: 9, documento: '000' }, d);
  assert.equal(r, 'sin-plan');
  assert.equal(calls.insert.length, 0);
  assert.deepEqual(calls.marcar, [9]);
});

test('concepto inválido: propaga el error y NO marca', async () => {
  const { d, calls } = deps({ insertarGestion: async () => { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; } });
  await assert.rejects(() => procesarPendiente({ id: 10, documento: '88123456' }, d), /concepto/);
  assert.equal(calls.marcar.length, 0);
});
