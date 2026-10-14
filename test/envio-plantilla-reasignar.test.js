'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decidirAgenteEnvio, debeMoverConversacion } = require('../src/services/envioPlantilla');

test('decidirAgenteEnvio: sin dueño → agente de la difusión y fija dueño (ambos modos)', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: false, duenoActual: null, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: null, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
});
test('decidirAgenteEnvio: con dueño y reasignar=false → respeta dueño, no fija', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: false, duenoActual: 9, agenteDifusion: 7 }), { agenteId: 9, fijarDueno: false });
});
test('decidirAgenteEnvio: con dueño distinto y reasignar=true → agente difusión, fija dueño', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: 9, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: true });
});
test('decidirAgenteEnvio: reasignar=true pero dueño ya es el de la difusión → no re-fija', () => {
  assert.deepEqual(decidirAgenteEnvio({ reasignar: true, duenoActual: 7, agenteDifusion: 7 }), { agenteId: 7, fijarDueno: false });
});

test('debeMoverConversacion: cerrada con agente distinto → true (ambos modos)', () => {
  assert.equal(debeMoverConversacion({ reasignar: false, estado: 'cerrada', convAgente: 9, agenteId: 7 }), true);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'cerrada', convAgente: 9, agenteId: 7 }), true);
});
test('debeMoverConversacion: abierta con agente distinto → solo con reasignar', () => {
  assert.equal(debeMoverConversacion({ reasignar: false, estado: 'abierta', convAgente: 9, agenteId: 7 }), false);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'abierta', convAgente: 9, agenteId: 7 }), true);
});
test('debeMoverConversacion: mismo agente o sin destino → false', () => {
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'cerrada', convAgente: 7, agenteId: 7 }), false);
  assert.equal(debeMoverConversacion({ reasignar: true, estado: 'abierta', convAgente: 9, agenteId: null }), false);
});
