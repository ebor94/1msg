'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paginaHistorial } = require('../src/integrations/onemsg/historial');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, get: async (url) => { llamadas.push(url); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('paginaHistorial arma la query y devuelve messages', async () => {
  const http = httpFalso([{ status: 200, data: { messages: [{ id: 'a', messageNumber: 5 }] } }]);
  const r = await paginaHistorial({ chatId: '57300@c.us', lastMessageNumber: 0, limit: 100 }, { http });
  assert.equal(r.length, 1);
  assert.match(http.llamadas[0], /\/messages\?/);
  assert.match(http.llamadas[0], /chatId=57300%40c\.us|chatId=57300@c\.us/);
  assert.match(http.llamadas[0], /lastMessageNumber=0/);
  assert.match(http.llamadas[0], /limit=100/);
});

test('paginaHistorial sin messages → []', async () => {
  const http = httpFalso([{ status: 200, data: {} }]);
  const r = await paginaHistorial({ chatId: 'x' }, { http });
  assert.deepEqual(r, []);
});

test('paginaHistorial ≥400 → OneMsgError', async () => {
  const http = httpFalso([{ status: 401, data: { error: { code: 'x' } } }]);
  await assert.rejects(() => paginaHistorial({ chatId: 'x' }, { http, baseMs: 1 }));
});
