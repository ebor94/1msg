'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { autenticar } = require('../src/services/auth');

const hash = bcrypt.hashSync('secreto', 10);
const deps = (over = {}) => ({
  buscarUsuario: async () => ({ id: 9, email: 'ssuarez', activo: 1, password: hash }),
  buscarAgente: async () => ({ id: 2, usuarioId: 9, usuario: 'ssuarez', rol: 'administrador', activo: true }),
  comparar: bcrypt.compare,
  ...over,
});

test('credenciales válidas → devuelve el agente', async () => {
  const r = await autenticar('ssuarez', 'secreto', deps());
  assert.equal(r.agente.id, 2);
});
test('clave incorrecta → null', async () => {
  assert.equal(await autenticar('ssuarez', 'mala', deps()), null);
});
test('usuario válido pero sin fila en wa_agentes → null', async () => {
  assert.equal(await autenticar('otro', 'secreto', deps({ buscarAgente: async () => null })), null);
});
test('usuario inactivo en serfuweb → null', async () => {
  assert.equal(await autenticar('x', 'secreto', deps({ buscarUsuario: async () => ({ id: 1, activo: 0, password: hash }) })), null);
});
