'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resumirConversacion, recortar255 } = require('../src/integrations/anthropic/resumen');

test('recortar255 recorta y limpia', () => {
  assert.equal(recortar255('  hola  '), 'hola');
  assert.equal(recortar255('a'.repeat(300)).length, 255);
});

test('resumirConversacion devuelve el texto del bloque text', async () => {
  const cliente = { messages: { create: async () => ({ content: [{ type: 'text', text: 'Cliente pagará el viernes.' }] }) } };
  const r = await resumirConversacion('Mensaje enviado: ...\nCliente: pago el viernes', { cliente });
  assert.equal(r, 'Cliente pagará el viernes.');
});

test('resumirConversacion recorta a 255 y tolera respuesta sin bloque text', async () => {
  const largo = { messages: { create: async () => ({ content: [{ type: 'text', text: 'x'.repeat(300) }] }) } };
  assert.equal((await resumirConversacion('t', { cliente: largo })).length, 255);
  const vacio = { messages: { create: async () => ({ content: [] }) } };
  assert.equal(await resumirConversacion('t', { cliente: vacio }), '');
});
