'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularBanner, MENSAJE_DEFECTO } = require('../src/services/mantenimiento');

test('banner apagado cuando no hay manual y el proveedor está arriba', () => {
  const b = calcularBanner({ manual: '0', proveedor: 'up', mensaje: '' });
  assert.equal(b.activo, false);
  assert.equal(b.origen, null);
});

test('banner encendido por caída del proveedor (automático)', () => {
  const b = calcularBanner({ manual: '0', proveedor: 'down', mensaje: '' });
  assert.equal(b.activo, true);
  assert.equal(b.origen, 'proveedor');
  assert.equal(b.mensaje, MENSAJE_DEFECTO); // usa el mensaje por defecto si no hay uno propio
});

test('banner encendido por switch manual, con mensaje personalizado', () => {
  const b = calcularBanner({ manual: '1', proveedor: 'up', mensaje: 'En mantenimiento programado.' });
  assert.equal(b.activo, true);
  assert.equal(b.origen, 'manual');
  assert.equal(b.mensaje, 'En mantenimiento programado.');
});

test('el manual tiene prioridad de origen sobre el proveedor', () => {
  const b = calcularBanner({ manual: '1', proveedor: 'down', mensaje: '' });
  assert.equal(b.activo, true);
  assert.equal(b.origen, 'manual');
});

test('valores ausentes (undefined) → banner apagado con defaults', () => {
  const b = calcularBanner({});
  assert.equal(b.activo, false);
  assert.equal(b.origen, null);
  assert.equal(b.mensaje, MENSAJE_DEFECTO);
});
