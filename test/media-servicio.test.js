'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { rutaMediaSegura } = require('../src/services/media');

const BASE = '/var/wa/media';

test('rutaMediaSegura: ruta normal → absoluta dentro de base', () => {
  assert.equal(rutaMediaSegura('2026/07/5/wamid.jpg', BASE), path.join(BASE, '2026/07/5/wamid.jpg'));
});

test('rutaMediaSegura: intento de salir con .. → null', () => {
  assert.equal(rutaMediaSegura('../../etc/passwd', BASE), null);
  assert.equal(rutaMediaSegura('2026/../../../secret', BASE), null);
});

test('rutaMediaSegura: vacío → null', () => {
  assert.equal(rutaMediaSegura('', BASE), null);
  assert.equal(rutaMediaSegura(null, BASE), null);
});

test('rutaMediaSegura: la base misma (. o vacío resuelto) → null', () => {
  assert.equal(rutaMediaSegura('.', BASE), null);
  assert.equal(rutaMediaSegura('2026/..', BASE), null);
});
