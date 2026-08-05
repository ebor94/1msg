'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/reportesController');

function resMock() {
  return {
    _status: 200, _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
  };
}

test('delDia responde 200 con las métricas', async () => {
  ctrl._setDeps({ metricasDelDia: async (f) => ({ fecha: f || '2026-08-05', agentes: [], totales: {} }) });
  const res = resMock();
  await ctrl.delDia({ query: { fecha: '2026-08-03' } }, res);
  assert.equal(res._status, 200);
  assert.equal(res._json.fecha, '2026-08-03');
});

test('delDia traduce error .status=400 a 400', async () => {
  ctrl._setDeps({ metricasDelDia: async () => { const e = new Error('fecha inválida'); e.status = 400; throw e; } });
  const res = resMock();
  await ctrl.delDia({ query: { fecha: 'x' } }, res);
  assert.equal(res._status, 400);
  assert.match(res._json.error, /fecha/);
});

test('vivo responde 200 con backlog', async () => {
  ctrl._setDeps({ backlogVivo: async () => ({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } }) });
  const res = resMock();
  await ctrl.vivo({}, res);
  assert.equal(res._status, 200);
  assert.equal(res._json.general.sinResponder, 0);
});
