'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearAgentesRecepcion, elegirRecepcion, validarIdsRecepcion, agentesRecepcionConfigurados } = require('../src/services/recepcion');

test('parsearAgentesRecepcion: JSON válido → ids (dedup, filtra no-enteros)', () => {
  assert.deepEqual(parsearAgentesRecepcion('[4,7,7,0,"x",9]', 4), [4, 7, 9]);
});
test('parsearAgentesRecepcion: vacío/basura → [fallback]', () => {
  assert.deepEqual(parsearAgentesRecepcion('', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion('no-json', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion('[]', 4), [4]);
  assert.deepEqual(parsearAgentesRecepcion(null, 4), [4]);
});
test('parsearAgentesRecepcion: vacío y sin fallback válido → []', () => {
  assert.deepEqual(parsearAgentesRecepcion('[]', null), []);
});

test('elegirRecepcion: elige el de menor carga', () => {
  assert.equal(elegirRecepcion([4, 7, 9], { 4: 5, 7: 2, 9: 8 }), 7);
});
test('elegirRecepcion: empate → el primero del orden', () => {
  assert.equal(elegirRecepcion([9, 4, 7], { 9: 3, 4: 3, 7: 3 }), 9);
});
test('elegirRecepcion: carga faltante cuenta como 0', () => {
  assert.equal(elegirRecepcion([4, 7], { 4: 1 }), 7);
});
test('elegirRecepcion: lista vacía → null', () => {
  assert.equal(elegirRecepcion([], {}), null);
});

test('validarIdsRecepcion: devuelve los pedidos que no están activos', () => {
  assert.deepEqual(validarIdsRecepcion([4, 7, 9], [4, 9]), [7]);
  assert.deepEqual(validarIdsRecepcion([4, 9], [4, 9]), []);
});

test('agentesRecepcionConfigurados: lee la clave y parsea (con mock de Ajuste)', async () => {
  const Ajuste = { findOne: async () => ({ valor: '[7,9]' }) };
  assert.deepEqual(await agentesRecepcionConfigurados({ Ajuste }), [7, 9]);
});
