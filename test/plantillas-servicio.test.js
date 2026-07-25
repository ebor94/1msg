'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, parsearPlantilla } = require('../src/services/plantillas');

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
  assert.equal(p.imagenDefault, null);
  assert.match(p.cuerpo, /Hola \{\{1\}\}/);
});

test('construirParamsHeader: sin url → [], con url → componente header imagen', () => {
  assert.deepEqual(construirParamsHeader(''), []);
  assert.deepEqual(construirParamsHeader('http://x/y.jpg'), [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'http://x/y.jpg' } }] },
  ]);
});

test('parsearPlantilla con header IMAGE expone namespace e imagenDefault', () => {
  const t = {
    name: 'medio_de_pago', language: 'es', category: 'UTILITY', status: 'approved', namespace: 'ns1',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['http://img'] } },
      { type: 'BODY', text: 'x {{1}}' },
    ],
  };
  const p = parsearPlantilla(t);
  assert.equal(p.imagenDefault, 'http://img');
  assert.equal(p.namespace, 'ns1');
  assert.equal(p.tieneImagen, true);
  assert.equal(p.variables, 1);
});
