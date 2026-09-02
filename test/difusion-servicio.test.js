'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { puedeIniciar, normalizarCarrusel, carruselListo } = require('../src/services/difusiones');

test('puedeIniciar solo en borrador con pendientes', () => {
  assert.equal(puedeIniciar('borrador', 3), true);
  assert.equal(puedeIniciar('borrador', 0), false);
  assert.equal(puedeIniciar('enviando', 3), false);
  assert.equal(puedeIniciar('finalizada', 3), false);
});

test('normalizarCarrusel dimensiona bodyVars y cards según la plantilla', () => {
  const def = { carrusel: { bodyVars: 1, cards: [{ variables: 4 }, { variables: 4 }] } };
  const out = normalizarCarrusel({ bodyVars: ['top'], cards: [{ vars: ['a', 'b', 'c', 'd'] }] }, def);
  assert.deepEqual(out.bodyVars, ['top']);
  assert.equal(out.cards.length, 2);
  assert.deepEqual(out.cards[0].vars, ['a', 'b', 'c', 'd']);
  assert.equal(out.cards[0].imagenUrl, null);
  assert.deepEqual(out.cards[1].vars, ['', '', '', '']); // la 2ª tarjeta llega vacía
});

test('carruselListo exige imágenes y textos de cada tarjeta', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 4, tieneImagen: true }] } };
  const incompleta = { carrusel: { bodyVars: ['x'], cards: [{ imagenUrl: null, vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(incompleta, def).ok, false);
  const completa = { carrusel: { bodyVars: ['x'], cards: [{ imagenUrl: 'https://x/a.jpg', vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(completa, def).ok, true);
});

test('carruselListo: plantilla plana siempre ok', () => {
  assert.equal(carruselListo({}, { esCarrusel: false }).ok, true);
});

test('carruselListo: exige los textos del encabezado (bodyVars)', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 4, tieneImagen: true }] } };
  const sinTop = { carrusel: { bodyVars: [''], cards: [{ imagenUrl: 'https://x/a.jpg', vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(sinTop, def).ok, false);
  const conTop = { carrusel: { bodyVars: ['Invitación'], cards: [{ imagenUrl: 'https://x/a.jpg', vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(conTop, def).ok, true);
});
