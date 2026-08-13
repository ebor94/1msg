'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { procesarPendiente, construirTranscripcion } = require('../src/services/resumenDifusiones');

test('construirTranscripcion etiqueta cliente/agente e incluye mensajes del agente', () => {
  const msgs = [
    { direccion: 'out', tipo: 'template', texto: 'Sr. Luis, el mensaje se envió por error, mil disculpas' },
    { direccion: 'in', tipo: 'text', texto: 'Okey buena tarde' },
  ];
  const r = construirTranscripcion('Hola ALBA, registramos mora de $66.300', msgs);
  assert.equal(r.huboRespuesta, true);
  assert.match(r.texto, /^Mensaje enviado por la empresa: Hola ALBA/);
  assert.match(r.texto, /Agente: Sr\. Luis, el mensaje se envió por error/); // texto de plantilla del agente preservado (no \[template\])
  assert.match(r.texto, /Cliente: Okey buena tarde/);
});

test('construirTranscripcion: solo mensajes del agente (sin entrantes) → huboRespuesta false', () => {
  const r = construirTranscripcion('Mensaje difusión', [{ direccion: 'out', tipo: 'text', texto: 'aclaración del agente' }]);
  assert.equal(r.huboRespuesta, false);
  assert.match(r.texto, /Agente: aclaración del agente/);
});

test('construirTranscripcion: media sin texto entrante → [tipo]', () => {
  const r = construirTranscripcion('Mensaje difusión', [{ direccion: 'in', tipo: 'image', texto: null }]);
  assert.equal(r.huboRespuesta, true);
  assert.match(r.texto, /Cliente: \[image\]/);
});

function deps(over = {}) {
  const calls = { insert: [], marcar: [], resumir: 0 };
  const base = {
    construirTexto: async () => ({ texto: 'Enviado: x\nCliente: pago el viernes', huboRespuesta: true }),
    resumir: async () => { calls.resumir++; return 'Cliente pagará el viernes.'; },
    consultarPlanes: async () => [{ num_plan: 111 }],
    registrarGestion: async (g) => { calls.insert.push(g); },
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
  const { d, calls } = deps({ registrarGestion: async () => { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; } });
  await assert.rejects(() => procesarPendiente({ id: 10, documento: '88123456' }, d), /concepto/);
  assert.equal(calls.marcar.length, 0);
});
