'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarMensaje } = require('../src/services/normalizador');

test('mensaje de /messages: self=1 → out', () => {
  const n = normalizarMensaje({ id: 'w1', type: 'chat', body: 'hola', self: 1, fromMe: 1, time: 1779290079, chatId: '57300@c.us' });
  assert.equal(n.direccion, 'out');
  assert.equal(n.texto, 'hola');
});

test('mensaje de /messages: self=0 → in; imagen → esMedia', () => {
  const n = normalizarMensaje({ id: 'w2', type: 'chat', body: 'que bien', self: 0, fromMe: 0, time: 1779290079, chatId: '57300@c.us', senderName: 'Eduardo' });
  assert.equal(n.direccion, 'in');
  const img = normalizarMensaje({ id: 'w3', type: 'image', body: 'https://s3/x.jpg', caption: 'pie', self: 0, time: 1779290079, chatId: '57300@c.us' });
  assert.equal(img.esMedia, true);
  assert.equal(img.mediaUrl, 'https://s3/x.jpg');
  assert.equal(img.texto, 'pie');
});
