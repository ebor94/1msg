'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cascada } = require('../src/services/asignacion');

// Mock mínimo de Agente.findByPk: devuelve el agente del mapa por id, o null.
function agenteMock(porId) {
  return { findByPk: async (id) => porId[id] || null };
}

test('dueño activo → continuidad (regla 1)', async () => {
  const Agente = agenteMock({ 5: { id: 5, activo: true } });
  const r = await cascada({ agenteDuenoId: 5 }, { Agente });
  assert.equal(r.agenteId, 5);
  assert.equal(r.tipo, 'auto_continuidad');
});

test('sin dueño → agente de recepción (id 4)', async () => {
  const Agente = agenteMock({ 4: { id: 4, activo: true } });
  const r = await cascada({ agenteDuenoId: null }, { Agente });
  assert.equal(r.agenteId, 4);
});

test('dueño inactivo → cae a recepción, no a general', async () => {
  const Agente = agenteMock({ 5: { id: 5, activo: false }, 4: { id: 4, activo: true } });
  const r = await cascada({ agenteDuenoId: 5 }, { Agente });
  assert.equal(r.agenteId, 4);
});

test('recepción inactivo → fallback a general (null)', async () => {
  const Agente = agenteMock({ 4: { id: 4, activo: false } });
  const r = await cascada({ agenteDuenoId: null }, { Agente });
  assert.equal(r.agenteId, null);
});
