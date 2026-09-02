'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { leerImagen, nombreArchivoImagen } = require('../src/services/difusionImagen');

function pngBuf(w, h) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  Buffer.from('IHDR').copy(b, 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpegBuf(w, h) {
  const b = Buffer.alloc(24);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0;
  b.writeUInt16BE(0x0011, 4); // largo del segmento
  b[6] = 0x08; // precisión
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}
function webpBuf() {
  const b = Buffer.alloc(24);
  Buffer.from('RIFF').copy(b, 0);
  Buffer.from('WEBP').copy(b, 8);
  return b;
}

test('leerImagen: PNG → formato png con dimensiones', () => {
  assert.deepEqual(leerImagen(pngBuf(900, 1600)), { formato: 'png', ancho: 900, alto: 1600 });
});
test('leerImagen: JPEG → formato jpg con dimensiones', () => {
  assert.deepEqual(leerImagen(jpegBuf(461, 571)), { formato: 'jpg', ancho: 461, alto: 571 });
});
test('leerImagen: WebP (disfrazado) → rechazado', () => {
  assert.throws(() => leerImagen(webpBuf()), /JPEG o PNG|no soportado/);
});
test('leerImagen: basura → rechazada', () => {
  assert.throws(() => leerImagen(Buffer.alloc(24)));
});
test('leerImagen: buffer diminuto → rechazado', () => {
  assert.throws(() => leerImagen(Buffer.alloc(8)));
});
test('leerImagen: > 5 MB → rechazado', () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  assert.throws(() => leerImagen(big), /5 MB/);
});
test('nombreArchivoImagen: por formato, con y sin índice de tarjeta', () => {
  assert.equal(nombreArchivoImagen(15, 'jpg', 0), 'dif-15-c0.jpg');
  assert.equal(nombreArchivoImagen(15, 'png', 2), 'dif-15-c2.png');
  assert.equal(nombreArchivoImagen(15, 'jpg'), 'dif-15.jpg');
  assert.throws(() => nombreArchivoImagen(15, 'webp'));
});
test('leerImagen: JPEG con byte de relleno 0xFF antes del SOF → dimensiones OK', () => {
  const b = Buffer.alloc(24);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xff; b[4] = 0xc0; // relleno 0xFF antes del SOF0
  b.writeUInt16BE(0x0011, 5);
  b[7] = 0x08;
  b.writeUInt16BE(700, 8);
  b.writeUInt16BE(500, 10);
  assert.deepEqual(leerImagen(b), { formato: 'jpg', ancho: 500, alto: 700 });
});
