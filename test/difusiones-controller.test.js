'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ctrl = require('../src/controllers/difusionesController');

function resMock() {
  return { _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } };
}

test('crear responde 201 con la campaña', async () => {
  ctrl._setServicio({ crear: async (d) => ({ id: 1, ...d }) });
  const res = resMock();
  await ctrl.crear({ body: { nombre: 'Mora agosto', plantilla: 'recordatorio_de_mora' }, agente: { id: 2 } }, res);
  assert.equal(res._status, 201);
  assert.equal(res._json.difusion.nombre, 'Mora agosto');
});
test('iniciar traduce .status=409 del servicio', async () => {
  ctrl._setServicio({ iniciar: async () => { const e = new Error('no'); e.status = 409; throw e; } });
  const res = resMock();
  await ctrl.iniciar({ params: { id: '1' } }, res);
  assert.equal(res._status, 409);
});
