'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recuperarHistorial } = require('../src/services/backfill');

function convFalsa() {
  return {
    id: 7,
    contacto: { waId: '57300@c.us' },
    historialRecuperadoEn: null,
    async update(campos) { Object.assign(this, campos); },
  };
}

// Mensaje falso: findOrCreate crea si no existe (por waMessageId).
function mensajeFalso() {
  const almacen = new Map();
  let seq = 100;
  return {
    almacen,
    async findOrCreate({ where, defaults }) {
      const k = where.waMessageId;
      if (almacen.has(k)) return [almacen.get(k), false];
      const inst = { id: (seq += 1), ...defaults, async update() {} };
      almacen.set(k, inst);
      return [inst, true];
    },
    async update() {},
  };
}

test('recupera todas las páginas hasta agotar y no duplica', async () => {
  // 2 páginas de 2 + una página final de 1 (< limit) → total 5 mensajes distintos.
  const paginas = [
    [{ id: 'm1', messageNumber: 10, type: 'chat', body: 'a', self: 0, time: 1 }, { id: 'm2', messageNumber: 11, type: 'chat', body: 'b', self: 1, time: 2 }],
    [{ id: 'm3', messageNumber: 12, type: 'chat', body: 'c', self: 0, time: 3 }, { id: 'm4', messageNumber: 13, type: 'chat', body: 'd', self: 0, time: 4 }],
    [{ id: 'm5', messageNumber: 14, type: 'chat', body: 'e', self: 0, time: 5 }],
  ];
  let i = 0;
  const deps = {
    limit: 2,
    paginaHistorial: async ({ lastMessageNumber }) => (i < paginas.length ? paginas[i++] : []),
    Mensaje: mensajeFalso(),
    guardarMediaDeMensaje: async () => null,
  };
  const conv = convFalsa();
  const r = await recuperarHistorial(conv, deps);
  assert.equal(r.recuperados, 5);
  assert.ok(conv.historialRecuperadoEn instanceof Date);
});

test('si ya está recuperado, no llama a 1msg', async () => {
  const conv = convFalsa();
  conv.historialRecuperadoEn = new Date();
  let llamado = false;
  const r = await recuperarHistorial(conv, { paginaHistorial: async () => { llamado = true; return []; }, Mensaje: mensajeFalso() });
  assert.equal(r.yaRecuperado, true);
  assert.equal(llamado, false);
});
