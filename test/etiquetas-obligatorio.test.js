'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { faltanEtiquetasObligatorias } = require('../src/services/etiquetas');

const org = { id: 1, categoria: 'origen' };
const intr = { id: 2, categoria: 'interes' };

test('faltanEtiquetasObligatorias: sin etiquetas → true', () => {
  assert.equal(faltanEtiquetasObligatorias([]), true);
  assert.equal(faltanEtiquetasObligatorias(null), true);
});
test('faltanEtiquetasObligatorias: solo origen → true', () => {
  assert.equal(faltanEtiquetasObligatorias([org]), true);
});
test('faltanEtiquetasObligatorias: solo interés → true', () => {
  assert.equal(faltanEtiquetasObligatorias([intr]), true);
});
test('faltanEtiquetasObligatorias: origen + interés → false', () => {
  assert.equal(faltanEtiquetasObligatorias([org, intr]), false);
});
