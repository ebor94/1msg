'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { guardarPromptIa } = require('../src/controllers/ajustesController');

function resFalso() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('guardarPromptIa rechaza prompt vacío con 422', async () => {
  const res = resFalso();
  await guardarPromptIa({ body: { prompt: '   ' } }, res);
  assert.equal(res.code, 422);
});
