'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cascada } = require('../src/services/asignacion');

// Mocks mínimos
function AgenteMock({ porId = {}, activos = [] }) {
  return {
    findByPk: async (id) => porId[id] || null,
    findAll: async ({ where }) => activos.filter((a) => where.id.includes(a.id) && a.activo).map((a) => ({ id: a.id })),
  };
}
function ConversacionMock(cargas) {
  return { count: async ({ where }) => cargas[where.agenteId] || 0 };
}
function AjusteMock(valor) {
  return { findOne: async () => (valor === undefined ? null : { valor }) };
}

test('cascada: dueño activo → continuidad', async () => {
  const Agente = AgenteMock({ porId: { 5: { id: 5, activo: true } } });
  const r = await cascada({ agenteDuenoId: 5 }, { Agente, Conversacion: ConversacionMock({}), Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, 5);
});

test('cascada: sin dueño → recepción con menos chats abiertos', async () => {
  const Agente = AgenteMock({ activos: [{ id: 7, activo: true }, { id: 9, activo: true }] });
  const Conversacion = ConversacionMock({ 7: 10, 9: 3 });
  const r = await cascada({ agenteDuenoId: null }, { Agente, Conversacion, Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, 9);
});

test('cascada: recepción configurada pero ninguno activo → general', async () => {
  const Agente = AgenteMock({ activos: [] }); // nadie activo entre los pedidos
  const r = await cascada({ agenteDuenoId: null }, { Agente, Conversacion: ConversacionMock({}), Ajuste: AjusteMock('[7,9]'), transaction: null });
  assert.equal(r.agenteId, null);
});

test('cascada: dueño inactivo → cae a recepción (no general)', async () => {
  const Agente = AgenteMock({ porId: { 5: { id: 5, activo: false } }, activos: [{ id: 7, activo: true }] });
  const r = await cascada({ agenteDuenoId: 5 }, { Agente, Conversacion: ConversacionMock({ 7: 0 }), Ajuste: AjusteMock('[7]'), transaction: null });
  assert.equal(r.agenteId, 7);
});

test('cascada: sin ajuste configurado → usa el agente de recepción del env (fallback)', async () => {
  const Agente = AgenteMock({ activos: [{ id: 4, activo: true }] });
  const r = await cascada({ agenteDuenoId: null }, { Agente, Conversacion: ConversacionMock({ 4: 0 }), Ajuste: AjusteMock(undefined), transaction: null });
  assert.equal(r.agenteId, 4);
});
