'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { construirFiltro, puedeVer } = require('../src/services/conversaciones');

const admin = { id: 1, rol: 'administrador' };
const asesor = { id: 2, rol: 'asesor' };

test('mías → filtra por el agente solicitante', () => {
  assert.deepEqual(construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor }).agenteId, 2);
});
test('general → agenteId null', () => {
  const w = construirFiltro({ bandeja: 'general', agenteSolicitante: asesor });
  assert.equal(w.agenteId, null);
});
test('todos como asesor → lanza 403', () => {
  assert.throws(() => construirFiltro({ bandeja: 'todos', agenteSolicitante: asesor }), (e) => e.status === 403);
});
test('todos como admin con filtro de agente', () => {
  assert.equal(construirFiltro({ bandeja: 'todos', agenteSolicitante: admin, agenteFiltro: 5 }).agenteId, 5);
});
test('puedeVer: asesor ve las suyas y las de general, no las de otro', () => {
  assert.equal(puedeVer(asesor, { agenteId: 2 }), true);
  assert.equal(puedeVer(asesor, { agenteId: null }), true);
  assert.equal(puedeVer(asesor, { agenteId: 3 }), false);
  assert.equal(puedeVer(admin, { agenteId: 3 }), true);
});
