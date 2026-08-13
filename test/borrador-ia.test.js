'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirHilo, generarBorrador } = require('../src/services/borradorIa');

test('construirHilo etiqueta cliente/empresa y media', () => {
  const h = construirHilo([
    { direccion: 'in', tipo: 'text', texto: 'hola' },
    { direccion: 'out', tipo: 'text', texto: 'buenas' },
    { direccion: 'in', tipo: 'image', texto: null },
  ]);
  assert.match(h, /Cliente: hola/);
  assert.match(h, /Empresa: buenas/);
  assert.match(h, /Cliente: \[image\]/);
});

function deps(over = {}) {
  const calls = { guardado: [], responder: 0 };
  const base = {
    cargarConversacion: async () => ({ conv: { id: 5, agenteId: 9 }, contacto: { gestionarConIa: true } }),
    cargarHilo: async () => [{ direccion: 'in', tipo: 'text', texto: 'hola' }],
    cargarPrompt: async () => 'Eres un asistente.',
    responder: async () => { calls.responder++; return 'Hola, con gusto te ayudo.'; },
    guardar: async (id, b) => { calls.guardado.push([id, b]); },
  };
  return { d: { ...base, ...over }, calls };
}

test('genera y guarda el borrador cuando el flag está activo', async () => {
  const { d, calls } = deps();
  const r = await generarBorrador(5, d);
  assert.equal(r, 'Hola, con gusto te ayudo.');
  assert.equal(calls.responder, 1);
  assert.deepEqual(calls.guardado[0], [5, 'Hola, con gusto te ayudo.']);
});

test('no hace nada si el contacto no tiene el flag', async () => {
  const { d, calls } = deps({ cargarConversacion: async () => ({ conv: { id: 5 }, contacto: { gestionarConIa: false } }) });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.responder, 0);
  assert.equal(calls.guardado.length, 0);
});

test('no guarda si la IA no devuelve texto', async () => {
  const { d, calls } = deps({ responder: async () => '   ' });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.guardado.length, 0);
});

test('no hace nada si no hay hilo', async () => {
  const { d, calls } = deps({ cargarHilo: async () => [] });
  const r = await generarBorrador(5, d);
  assert.equal(r, null);
  assert.equal(calls.responder, 0);
});
