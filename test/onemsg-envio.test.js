'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarTexto } = require('../src/integrations/onemsg/envio');

function httpFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    post: async (url, body) => {
      llamadas.push({ url, body: body.toString() });
      const r = respuestas[llamadas.length - 1];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('envío exitoso devuelve id y sent', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.NEW1' } }]);
  const r = await enviarTexto({ chatId: '57300@c.us', texto: 'hola' }, { http });
  assert.equal(r.id, 'wamid.NEW1');
  assert.equal(r.sent, true);
  assert.match(http.llamadas[0].url, /\/sendMessage\?token=/);
  assert.match(http.llamadas[0].body, /body=hola/);
  assert.match(http.llamadas[0].body, /chatId=57300/);
});

test('429 reintenta y luego pasa', async () => {
  const http = httpFalso([
    { status: 429, data: { message: 'rate limit' } },
    { status: 200, data: { sent: true, id: 'wamid.NEW2' } },
  ]);
  const r = await enviarTexto({ chatId: '57300@c.us', texto: 'x' }, { http, baseMs: 1 });
  assert.equal(r.id, 'wamid.NEW2');
  assert.equal(http.llamadas.length, 2);
});

test('respuesta sin sent lanza OneMsgError con código', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, error: { code: 131047 }, message: 'outside window' } }]);
  await assert.rejects(() => enviarTexto({ chatId: '57300@c.us', texto: 'x' }, { http, baseMs: 1 }), (e) => e.codigo === '131047');
});
