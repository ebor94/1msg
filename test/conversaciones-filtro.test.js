'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
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

test('mías normal excluye archivadas (archivadaEn: null)', () => {
  const w = construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor });
  assert.equal(w.archivadaEn, null);
});
test('todos con ocultos (admin) → OR de archivada / contacto desactivado', () => {
  const w = construirFiltro({ bandeja: 'todos', agenteSolicitante: admin, ocultos: true });
  assert.ok(Array.isArray(w[Op.or]), 'debe existir un Op.or con las dos condiciones');
  assert.equal(w[Op.or].length, 2);
  assert.equal(w.archivadaEn, undefined, 'en ocultos no se fuerza archivadaEn: null');
});
test('ocultos ignorado fuera de todos → sigue excluyendo archivadas', () => {
  const w = construirFiltro({ bandeja: 'mias', agenteSolicitante: asesor, ocultos: true });
  assert.equal(w.archivadaEn, null);
});
test('todos con ocultos como asesor → 403', () => {
  assert.throws(() => construirFiltro({ bandeja: 'todos', agenteSolicitante: asesor, ocultos: true }), (e) => e.status === 403);
});
