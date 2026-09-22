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

test('carruselListo: distinta relación de aspecto → no ok', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'], ancho: 1600, alto: 900 },
  ] } };
  assert.equal(carruselListo(dif, def).ok, false);
});

test('carruselListo: misma relación de aspecto → ok', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'], ancho: 450, alto: 800 },
  ] } };
  assert.equal(carruselListo(dif, def).ok, true);
});

test('carruselListo: falta ancho/alto en una tarjeta → omite el chequeo de aspecto (ok)', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'] },
  ] } };
  assert.equal(carruselListo(dif, def).ok, true);
});

test('carruselListo: cuerpo de tarjeta hidratado > 160 → no ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Hola {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['ok'], cards: [{ imagenUrl: 'a', vars: ['a'.repeat(200)] }] } };
  const r = carruselListo(dif, def);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /tarjeta 1.*160/);
});

test('carruselListo: cuerpo de tarjeta ≤ 160 → ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Hola {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['ok'], cards: [{ imagenUrl: 'a', vars: ['corto'] }] } };
  assert.equal(carruselListo(dif, def).ok, true);
});

test('carruselListo: encabezado hidratado > 1024 → no ok', () => {
  const def = { esCarrusel: true, cuerpo: 'Enc: {{1}}', carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true, texto: 'X: {{1}}' }] } };
  const dif = { carrusel: { bodyVars: ['b'.repeat(1100)], cards: [{ imagenUrl: 'a', vars: ['corto'] }] } };
  const r = carruselListo(dif, def);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /encabezado.*1024/);
});
