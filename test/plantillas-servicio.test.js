'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contarVariables, renderizarCuerpo, construirParams, parsearPlantilla } = require('../src/services/plantillas');

test('contarVariables cuenta {{n}} distintos', () => {
  assert.equal(contarVariables('Hola {{1}}, saldo {{2}} vence {{2}}'), 2);
  assert.equal(contarVariables('sin variables'), 0);
});

test('renderizarCuerpo sustituye', () => {
  assert.equal(renderizarCuerpo('Hola {{1}}, ${{2}}', ['Ana', '5000']), 'Hola Ana, $5000');
});

test('construirParams: vacío → [], con vars → componente body', () => {
  assert.deepEqual(construirParams([]), []);
  assert.deepEqual(construirParams(['a', 'b']), [
    { type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
  ]);
});

test('parsearPlantilla extrae cuerpo, variables, flags', () => {
  const t = {
    name: 'renovacion_mora', language: 'es', category: 'MARKETING', status: 'approved',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Hola' },
      { type: 'BODY', text: 'Hola {{1}}, saldo {{2}}, plan {{3}}' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'ok' }] },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.name, 'renovacion_mora');
  assert.equal(p.variables, 3);
  assert.equal(p.tieneBotones, true);
  assert.equal(p.tieneImagen, false);
  assert.match(p.cuerpo, /Hola \{\{1\}\}/);
});
