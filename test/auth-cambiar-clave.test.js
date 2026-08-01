'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { cambiarClave } = require('../src/services/auth');

const hashActual = bcrypt.hashSync('claveVieja1', 10);

function deps(over = {}) {
  const llamadas = { actualizar: [] };
  const base = {
    buscarPorId: async () => ({ id: 9, password: hashActual, activo: 1 }),
    comparar: bcrypt.compare,
    hashear: async (c) => bcrypt.hash(c, 10),
    actualizar: async (id, hash) => { llamadas.actualizar.push({ id, hash }); },
    _llamadas: llamadas,
  };
  return { ...base, ...over };
}

test('clave actual incorrecta → 403 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(
    () => cambiarClave(9, 'malaClave', 'nuevaClave1', d),
    (e) => e.status === 403 && e.codigo === 'clave_actual_incorrecta',
  );
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('clave nueva de 7 caracteres → 422 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', '1234567', d), (e) => e.status === 422);
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('clave nueva igual a la actual → 422 y NO actualiza', async () => {
  const d = deps();
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', 'claveVieja1', d), (e) => e.status === 422);
  assert.equal(d._llamadas.actualizar.length, 0);
});

test('usuario inactivo → 404', async () => {
  const d = deps({ buscarPorId: async () => ({ id: 9, password: hashActual, activo: 0 }) });
  await assert.rejects(() => cambiarClave(9, 'claveVieja1', 'nuevaClave1', d), (e) => e.status === 404);
});

test('camino feliz → actualiza con un hash bcrypt y devuelve ok', async () => {
  const d = deps();
  const r = await cambiarClave(9, 'claveVieja1', 'nuevaClave1', d);
  assert.deepEqual(r, { ok: true });
  assert.equal(d._llamadas.actualizar.length, 1);
  const guardado = d._llamadas.actualizar[0];
  assert.equal(guardado.id, 9);
  assert.match(guardado.hash, /^\$2[aby]\$/); // hash bcrypt, no la clave en claro
  assert.notEqual(guardado.hash, 'nuevaClave1');
});
