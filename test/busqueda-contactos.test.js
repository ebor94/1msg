'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirResultado } = require('../src/services/busquedaContactos');

const contacto = { id: 3, waId: '57300@c.us', telefono: '57300', nombreWa: 'Ana WA', nombreDisplay: 'Ana' };

test('conversación mía → esMio, nombre display, conversacion abrible', () => {
  const conv = { id: 9, agenteId: 5, ventanaExpiraEn: null, agente: { id: 5, nombre: 'Yo' } };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.contactoId, 3);
  assert.equal(r.nombre, 'Ana');
  assert.equal(r.conversacionId, 9);
  assert.equal(r.esMio, true);
  assert.equal(r.esGeneral, false);
  assert.equal(r.agenteActualNombre, 'Yo');
  assert.equal(r.conversacion.id, 9);
  assert.equal(r.conversacion.contacto.waId, '57300@c.us');
});

test('conversación general → esGeneral, sin agente', () => {
  const conv = { id: 9, agenteId: null, ventanaExpiraEn: null, agente: null };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.esGeneral, true);
  assert.equal(r.esMio, false);
  assert.equal(r.agenteActualNombre, null);
});

test('conversación de otro → ni mío ni general', () => {
  const conv = { id: 9, agenteId: 7, ventanaExpiraEn: null, agente: { id: 7, nombre: 'Otro' } };
  const r = construirResultado(contacto, conv, 5);
  assert.equal(r.esMio, false);
  assert.equal(r.esGeneral, false);
  assert.equal(r.agenteActualNombre, 'Otro');
});

test('contacto sin conversación → conversacionId y conversacion null', () => {
  const r = construirResultado({ ...contacto, nombreDisplay: null, nombreWa: null }, null, 5);
  assert.equal(r.conversacionId, null);
  assert.equal(r.conversacion, null);
  assert.equal(r.nombre, '57300'); // cae al teléfono
});
