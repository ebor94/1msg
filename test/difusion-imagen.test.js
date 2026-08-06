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
