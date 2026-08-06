'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick } = require('../src/workers/recordatorios');

function deps(over = {}) {
  return {
    dentroDeVentana: () => true,
    obtenerAjustes: async () => ({ recordatorio_texto: 'hola', recordatorio_imagen_url: 'http://x/y.png' }),
    recordatorioConfigurado: () => true,
    siguiente: async () => null,
    enviar: async () => 'enviado',
    ...over,
  };
}

test('fuera de ventana → no envía', async () => {
  let n = 0;
  const r = await tick(new Date(), deps({ dentroDeVentana: () => false, enviar: async () => { n++; return 'enviado'; } }));
  assert.equal(r, 'fuera-ventana'); assert.equal(n, 0);
});
test('sin configurar → sin-config', async () => {
  assert.equal(await tick(new Date(), deps({ recordatorioConfigurado: () => false })), 'sin-config');
});
test('nada pendiente → nada', async () => {
  assert.equal(await tick(new Date(), deps({ siguiente: async () => null })), 'nada');
});
test('hay uno → envía', async () => {
  let n = 0;
  const r = await tick(new Date(), deps({ siguiente: async () => ({ id: 1, contactoId: 2 }), enviar: async () => { n++; return 'enviado'; } }));
  assert.equal(r, 'enviado'); assert.equal(n, 1);
});
