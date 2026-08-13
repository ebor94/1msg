'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { responder, recortar600 } = require('../src/integrations/anthropic/responder');

test('recortar600 recorta y limpia', () => {
  assert.equal(recortar600('  hola  '), 'hola');
  assert.equal(recortar600('a'.repeat(800)).length, 600);
});

test('responder llama al SDK con Sonnet, el prompt como system y el hilo, y devuelve el texto', async () => {
  let args = null;
  const cliente = { messages: { create: async (a) => { args = a; return { content: [{ type: 'text', text: 'Con gusto, ¿en qué te ayudo?' }] }; } } };
  const r = await responder('Cliente: hola', 'Eres un asistente.', { cliente });
  assert.equal(r, 'Con gusto, ¿en qué te ayudo?');
  assert.equal(args.model, 'claude-sonnet-5');
  assert.deepEqual(args.thinking, { type: 'disabled' });
  assert.equal(args.system, 'Eres un asistente.');
  assert.equal(args.messages[0].role, 'user');
  assert.equal(args.messages[0].content, 'Cliente: hola');
});

test('responder recorta a 600 y tolera respuesta sin bloque text', async () => {
  const largo = { messages: { create: async () => ({ content: [{ type: 'text', text: 'x'.repeat(800) }] }) } };
  assert.equal((await responder('t', 'p', { cliente: largo })).length, 600);
  const vacio = { messages: { create: async () => ({ content: [] }) } };
  assert.equal(await responder('t', 'p', { cliente: vacio }), '');
});
