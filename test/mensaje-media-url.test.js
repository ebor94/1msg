'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Mensaje } = require('../src/models');

test('Mensaje tiene mediaUrl', () => {
  assert.ok(Mensaje.rawAttributes.mediaUrl, 'falta mediaUrl');
});
