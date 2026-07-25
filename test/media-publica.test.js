'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registrar, resolver, TTL_MS } = require('../src/services/mediaPublica');

test('registrar → token hex de 64 chars; resolver lo devuelve', () => {
  const token = registrar('2026/07/5/out-x.jpg', 'image/jpeg');
  assert.match(token, /^[a-f0-9]{64}$/);
  const e = resolver(token);
  assert.equal(e.rutaRelativa, '2026/07/5/out-x.jpg');
  assert.equal(e.mime, 'image/jpeg');
});

test('resolver token desconocido → null', () => {
  assert.equal(resolver('nope'), null);
});

test('resolver tras expirar → null', () => {
  const token = registrar('a/b.jpg', 'image/jpeg');
  assert.equal(resolver(token, Date.now() + TTL_MS + 1000), null);
});
