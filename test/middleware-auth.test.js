'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firmar } = require('../src/utils/jwt');
const { requireAuth, requireAdmin } = require('../src/middlewares/auth');

function resFalso() {
  return { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

test('sin header → 401', () => {
  const res = resFalso(); let siguiente = false;
  requireAuth({ get: () => '' }, res, () => { siguiente = true; });
  assert.equal(res.code, 401); assert.equal(siguiente, false);
});
test('con token válido → next y req.agente', () => {
  const token = firmar({ id: 2, rol: 'administrador' });
  const req = { get: () => `Bearer ${token}` }; const res = resFalso(); let siguiente = false;
  requireAuth(req, res, () => { siguiente = true; });
  assert.equal(siguiente, true); assert.equal(req.agente.id, 2);
});
test('requireAdmin bloquea a asesor con 403', () => {
  const res = resFalso(); let siguiente = false;
  requireAdmin({ agente: { rol: 'asesor' } }, res, () => { siguiente = true; });
  assert.equal(res.code, 403); assert.equal(siguiente, false);
});
