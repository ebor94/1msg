'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/recordatoriosController');

function resMock() {
  return { _s: 200, _j: null, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; } };
}

test('obtener responde el recordatorio', async () => {
  ctrl._setServicio({ recordatorioDeContacto: async () => ({ activo: true, diaMes: 5 }) });
  const res = resMock();
  await ctrl.obtener({ params: { id: '9' } }, res);
  assert.equal(res._j.recordatorio.diaMes, 5);
});
test('guardar traduce .status=400', async () => {
  ctrl._setServicio({ guardarRecordatorio: async () => { const e = new Error('día inválido'); e.status = 400; throw e; } });
  const res = resMock();
  await ctrl.guardar({ params: { id: '9' }, body: { activo: true, diaMes: 99 }, agente: { id: 1 } }, res);
  assert.equal(res._s, 400);
});
