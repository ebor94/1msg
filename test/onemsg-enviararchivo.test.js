'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarArchivo } = require('../src/integrations/onemsg/media');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, post: async (url, body) => { llamadas.push({ url, body }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('enviarArchivo exitoso manda body=url y mediaType', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.F1' } }]);
  const r = await enviarArchivo({ chatId: '57300@c.us', url: 'https://x/y.jpg', mediaType: 'image', caption: 'hola', filename: 'y.jpg' }, { http });
  assert.equal(r.id, 'wamid.F1');
  assert.match(http.llamadas[0].url, /\/sendFile\?token=/);
  const params = http.llamadas[0].body; // URLSearchParams
  assert.equal(params.get('body'), 'https://x/y.jpg');
  assert.equal(params.get('mediaType'), 'image');
  assert.equal(params.get('chatId'), '57300@c.us');
});

test('enviarArchivo sin sent → OneMsgError', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, message: 'wrong file' } }]);
  await assert.rejects(() => enviarArchivo({ chatId: '1', url: 'https://x/y.jpg', mediaType: 'image' }, { http, baseMs: 1 }));
});

test('enviarArchivo con voice=true manda voice', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.V1' } }]);
  await enviarArchivo({ chatId: 'x@c.us', url: 'https://x/v.ogg', mediaType: 'audio', voice: true }, { http });
  assert.equal(http.llamadas[0].body.get('voice'), 'true');
});
