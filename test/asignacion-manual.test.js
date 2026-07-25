'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipoDeAsignacion, roomsDeAsignacion } = require('../src/services/asignacionManual');

test('tipoDeAsignacion', () => {
  assert.equal(tipoDeAsignacion(null, 5), 'toma_manual');
  assert.equal(tipoDeAsignacion(3, null), 'devuelta_general');
  assert.equal(tipoDeAsignacion(3, 5), 'reasignacion');
});

test('roomsDeAsignacion une origen y destino sin duplicar', () => {
  const r = roomsDeAsignacion(3, 5);
  assert.ok(r.includes('agente:3') && r.includes('agente:5') && r.includes('admins'));
  assert.equal(new Set(r).size, r.length);
  const g = roomsDeAsignacion(null, 5);
  assert.ok(g.includes('general') && g.includes('agente:5'));
});
