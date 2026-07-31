'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agruparCatalogo, CATEGORIAS } = require('../src/services/etiquetas');

test('CATEGORIAS expone origen e interes', () => {
  assert.equal(CATEGORIAS.ORIGEN, 'origen');
  assert.equal(CATEGORIAS.INTERES, 'interes');
});

test('agruparCatalogo separa por categoria y ordena por orden y luego nombre', () => {
  const filas = [
    { id: 3, nombre: 'Web', categoria: 'origen', color: '#111', orden: 2 },
    { id: 1, nombre: 'Prenecesidad', categoria: 'interes', color: '#222', orden: 1 },
    { id: 2, nombre: 'Mostrador', categoria: 'origen', color: '#333', orden: 1 },
    { id: 4, nombre: 'Abono', categoria: 'interes', color: '#444', orden: 1 },
  ];
  const r = agruparCatalogo(filas);
  assert.deepEqual(r.origen.map((e) => e.id), [2, 3]); // orden 1 antes que 2
  assert.deepEqual(r.interes.map((e) => e.id), [4, 1]); // mismo orden → por nombre: Abono, Prenecesidad
});

test('agruparCatalogo con lista vacía devuelve grupos vacíos', () => {
  assert.deepEqual(agruparCatalogo([]), { origen: [], interes: [] });
});
