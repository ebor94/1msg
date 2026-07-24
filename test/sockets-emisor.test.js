'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomsPara } = require('../src/sockets/emisor');

test('roomsPara con agente → su room + admins', () => {
  assert.deepEqual(roomsPara({ agenteId: 3, general: false }), ['agente:3', 'admins']);
});
test('roomsPara general → general + admins', () => {
  assert.deepEqual(roomsPara({ agenteId: null, general: true }), ['general', 'admins']);
});
