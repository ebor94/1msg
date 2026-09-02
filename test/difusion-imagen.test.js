'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nombreArchivoImagen, rutaAbsolutaImagen } = require('../src/services/difusionImagen');

test('nombreArchivoImagen usa la extensión según el mime', () => {
  assert.equal(nombreArchivoImagen(7, 'image/png'), 'dif-7.png');
  assert.equal(nombreArchivoImagen(7, 'image/jpeg'), 'dif-7.jpg');
});
test('nombreArchivoImagen rechaza mime no soportado con 400', () => {
  assert.throws(() => nombreArchivoImagen(7, 'application/pdf'), (e) => e.status === 400);
});
test('rutaAbsolutaImagen rechaza path traversal', () => {
  assert.throws(() => rutaAbsolutaImagen('../secreto'), (e) => e.status === 400);
  assert.throws(() => rutaAbsolutaImagen('a/b'), (e) => e.status === 400);
});
test('nombreArchivoImagen: con índice de tarjeta añade sufijo -cN', () => {
  assert.equal(nombreArchivoImagen(15, 'image/jpeg', 0), 'dif-15-c0.jpg');
  assert.equal(nombreArchivoImagen(15, 'image/png', 2), 'dif-15-c2.png');
  assert.equal(nombreArchivoImagen(15, 'image/jpeg'), 'dif-15.jpg'); // sin índice: comportamiento actual
});
