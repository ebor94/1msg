'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearFiltros } = require('../src/services/informeContactos');

test('vacío → solo paginación por defecto', () => {
  const f = parsearFiltros({});
  assert.equal(f.tam, 25);
  assert.equal(f.pagina, 0);
  assert.equal(f.compro, undefined);
  assert.equal(f.estado, undefined);
});

test('compro y estado válidos (incl. "sin")', () => {
  assert.equal(parsearFiltros({ compro: 'si' }).compro, 'si');
  assert.equal(parsearFiltros({ compro: 'sin' }).compro, 'sin');
  assert.equal(parsearFiltros({ estado: 'cerrada' }).estado, 'cerrada');
  assert.equal(parsearFiltros({ estado: 'sin' }).estado, 'sin');
});

test('compro inválido → 422', () => {
  assert.throws(() => parsearFiltros({ compro: 'quiza' }), (e) => e.status === 422);
});
test('estado inválido → 422', () => {
  assert.throws(() => parsearFiltros({ estado: 'archivada' }), (e) => e.status === 422);
});

test('origenId/interesId: enteros se toman, basura se ignora', () => {
  const f = parsearFiltros({ origenId: '3', interesId: 'x' });
  assert.equal(f.origenId, 3);
  assert.equal(f.interesId, undefined);
});

test('rango: hastaExcl = hasta + 1 día', () => {
  const f = parsearFiltros({ desde: '2026-07-01', hasta: '2026-07-31' });
  assert.equal(f.desde.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(f.hastaExcl.toISOString().slice(0, 10), '2026-08-01');
});
test('desde > hasta → 422', () => {
  assert.throws(() => parsearFiltros({ desde: '2026-08-01', hasta: '2026-07-01' }), (e) => e.status === 422);
});
test('fecha inválida → 422', () => {
  assert.throws(() => parsearFiltros({ desde: 'ayer' }), (e) => e.status === 422);
});

test('tam se acota 1..100 (default 25), pagina ≥ 0', () => {
  assert.equal(parsearFiltros({ tam: '500' }).tam, 100);
  assert.equal(parsearFiltros({ tam: '0' }).tam, 25);
  assert.equal(parsearFiltros({ tam: '10' }).tam, 10);
  assert.equal(parsearFiltros({ pagina: '-3' }).pagina, 0);
  assert.equal(parsearFiltros({ pagina: '2' }).pagina, 2);
});
