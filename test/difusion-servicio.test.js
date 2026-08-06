'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { puedeIniciar } = require('../src/services/difusiones');

test('puedeIniciar solo en borrador con pendientes', () => {
  assert.equal(puedeIniciar('borrador', 3), true);
  assert.equal(puedeIniciar('borrador', 0), false);
  assert.equal(puedeIniciar('enviando', 3), false);
  assert.equal(puedeIniciar('finalizada', 3), false);
});
