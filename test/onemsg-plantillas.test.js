'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarPlantilla } = require('../src/integrations/onemsg/plantillas');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, post: async (url, body) => { llamadas.push({ url, body }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('enviarPlantilla exitoso', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.T1' } }]);
  const r = await enviarPlantilla({ phone: '573001112233', template: 'x', language: { code: 'es' }, params: [] }, { http });
  assert.equal(r.id, 'wamid.T1');
  assert.match(http.llamadas[0].url, /\/sendTemplate\?token=/);
  assert.equal(http.llamadas[0].body.template, 'x');
});

test('enviarPlantilla sin sent → OneMsgError', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, message: 'rejected' } }]);
  await assert.rejects(() => enviarPlantilla({ phone: '1', template: 'x', language: { code: 'es' }, params: [] }, { http, baseMs: 1 }));
});
