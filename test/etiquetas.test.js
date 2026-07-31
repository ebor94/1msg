'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agruparCatalogo, CATEGORIAS, normalizarRango, validarNuevaEtiqueta } = require('../src/services/etiquetas');

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

test('normalizarRango: rango válido, hastaExclusivo = hasta + 1 día', () => {
  const r = normalizarRango('2026-07-01', '2026-07-31');
  assert.equal(r.desde.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(r.hastaExclusivo.toISOString().slice(0, 10), '2026-08-01');
});

test('normalizarRango: desde > hasta lanza 400', () => {
  assert.throws(() => normalizarRango('2026-08-01', '2026-07-01'), (e) => e.status === 400);
});

test('normalizarRango: fecha inválida lanza 400', () => {
  assert.throws(() => normalizarRango('no-fecha', '2026-07-01'), (e) => e.status === 400);
});

test('validarNuevaEtiqueta: normaliza y aplica color por defecto', () => {
  const r = validarNuevaEtiqueta({ nombre: '  Web  ', categoria: 'origen' });
  assert.deepEqual(r, { nombre: 'Web', categoria: 'origen', color: '#888780' });
});

test('validarNuevaEtiqueta: categoría inválida lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: 'X', categoria: 'otra' }), (e) => e.status === 422);
});

test('validarNuevaEtiqueta: nombre vacío lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: '   ', categoria: 'origen' }), (e) => e.status === 422);
});

test('validarNuevaEtiqueta: color mal formado lanza 422', () => {
  assert.throws(() => validarNuevaEtiqueta({ nombre: 'X', categoria: 'origen', color: 'rojo' }), (e) => e.status === 422);
});
