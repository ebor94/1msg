'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ventanaAbierta, conFirma, contactoActivo } = require('../src/services/envio');

test('ventanaAbierta: futura=true, pasada/null=false', () => {
  const enUnaHora = new Date(Date.now() + 3600e3);
  const haceUnaHora = new Date(Date.now() - 3600e3);
  assert.equal(ventanaAbierta(enUnaHora), true);
  assert.equal(ventanaAbierta(haceUnaHora), false);
  assert.equal(ventanaAbierta(null), false);
});

test('conFirma antepone la firma si existe', () => {
  assert.equal(conFirma('Ana | ', 'hola'), 'Ana | hola');
  assert.equal(conFirma(null, 'hola'), 'hola');
  assert.equal(conFirma('', 'hola'), 'hola');
});

test('contactoActivo: false si desactivadoEn tiene fecha, true si null', () => {
  assert.equal(contactoActivo({ desactivadoEn: new Date() }), false);
  assert.equal(contactoActivo({ desactivadoEn: null }), true);
  assert.equal(contactoActivo({}), true);
  assert.equal(contactoActivo(null), true);
});
