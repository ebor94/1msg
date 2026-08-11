'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick, esHoraDeResumen } = require('../src/workers/resumenDifusiones');

// 2026-08-08 12:00 UTC = 07:00 Colombia (antes de las 19); 2026-08-08 00:30 UTC = 19:30 del día 7.
test('esHoraDeResumen: verdadero solo desde las 19:00 hora Colombia', () => {
  assert.equal(esHoraDeResumen(new Date('2026-08-08T12:00:00Z')), false); // 07:00 CO
  assert.equal(esHoraDeResumen(new Date('2026-08-09T00:30:00Z')), true);  // 19:30 CO
});

function deps(over = {}) {
  return { esHora: () => true, siguiente: async () => null, procesar: async () => 'resumido', marcar: async () => {}, ...over };
}

test('fuera de hora → fuera-hora, no consulta pendientes', async () => {
  let visto = 0;
  const d = deps({ esHora: () => false, siguiente: async () => { visto++; return null; } });
  assert.equal(await tick(new Date(), d), 'fuera-hora');
  assert.equal(visto, 0);
});
test('sin pendientes → nada', async () => {
  assert.equal(await tick(new Date(), deps({ siguiente: async () => null })), 'nada');
});
test('procesa un pendiente → devuelve el resultado del servicio', async () => {
  const d = deps({ siguiente: async () => ({ id: 1, documento: '9' }), procesar: async () => 'resumido' });
  assert.equal(await tick(new Date(), d), 'resumido');
});
test('concepto inválido → error-config, NO marca', async () => {
  let marcado = 0;
  const d = deps({
    siguiente: async () => ({ id: 1, documento: '9' }),
    procesar: async () => { const e = new Error('concepto no permitido'); e.codigo = 'concepto_invalido'; throw e; },
    marcar: async () => { marcado++; },
  });
  assert.equal(await tick(new Date(), d), 'error-config');
  assert.equal(marcado, 0);
});
test('fallo de IA/gestión → fallo, marca para no bloquear', async () => {
  let marcado = 0;
  const d = deps({
    siguiente: async () => ({ id: 1, documento: '9' }),
    procesar: async () => { throw new Error('timeout IA'); },
    marcar: async (id) => { marcado = id; },
  });
  assert.equal(await tick(new Date(), d), 'fallo');
  assert.equal(marcado, 1);
});
