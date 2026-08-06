'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tick } = require('../src/workers/difusiones');

function deps(over = {}) {
  return {
    dentroDeVentana: () => true,
    campanaActiva: async () => null,
    siguienteDestinatario: async () => null,
    catalogo: async () => [],
    enviar: async () => 'enviado',
    finalizar: async () => {},
    ...over,
  };
}

test('tick sin campaña activa → sin-campana', async () => {
  assert.equal(await tick(new Date(), deps()), 'sin-campana');
});
test('tick fuera de ventana → fuera-ventana (no envía)', async () => {
  let envio = 0;
  const d = deps({ dentroDeVentana: () => false, campanaActiva: async () => ({ id: 1 }), enviar: async () => { envio++; return 'enviado'; } });
  assert.equal(await tick(new Date(), d), 'fuera-ventana');
  assert.equal(envio, 0);
});
test('tick con campaña y sin pendientes → finaliza', async () => {
  let finalizada = 0;
  const d = deps({ campanaActiva: async () => ({ id: 1, plantillaNombre: 'x' }), siguienteDestinatario: async () => null, finalizar: async () => { finalizada++; } });
  assert.equal(await tick(new Date(), d), 'finalizada');
  assert.equal(finalizada, 1);
});
test('tick con destinatario pendiente → envía', async () => {
  let envio = 0;
  const d = deps({
    campanaActiva: async () => ({ id: 1, plantillaNombre: 'recordatorio_de_mora' }),
    siguienteDestinatario: async () => ({ id: 9 }),
    catalogo: async () => [{ name: 'recordatorio_de_mora', variables: 2 }],
    enviar: async () => { envio++; return 'enviado'; },
  });
  assert.equal(await tick(new Date(), d), 'enviado');
  assert.equal(envio, 1);
});
