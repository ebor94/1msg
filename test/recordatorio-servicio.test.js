'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordatorioConfigurado } = require('../src/services/recordatorios');

test('recordatorioConfigurado exige texto y URL', () => {
  assert.equal(recordatorioConfigurado({ recordatorio_texto: 'hola', recordatorio_imagen_url: 'http://x/y.png' }), true);
  assert.equal(recordatorioConfigurado({ recordatorio_texto: '', recordatorio_imagen_url: 'http://x/y.png' }), false);
  assert.equal(recordatorioConfigurado({ recordatorio_texto: 'hola', recordatorio_imagen_url: '' }), false);
  assert.equal(recordatorioConfigurado({}), false);
});
