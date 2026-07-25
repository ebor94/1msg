'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarPlantilla, listarPlantillas } = require('../src/integrations/onemsg/plantillas');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, post: async (url, body) => { llamadas.push({ url, body }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

function httpFalsoGet(respuestas) {
  const llamadas = [];
  return { llamadas, get: async (url) => { llamadas.push({ url }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
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

test('listarPlantillas exitoso filtra solo approved', async () => {
  const http = httpFalsoGet([
    {
      status: 200,
      data: {
        templates: [
          { name: 'a', status: 'approved' },
          { name: 'b', status: 'rejected' },
        ],
      },
    },
  ]);
  const r = await listarPlantillas({ http });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'a');
});

test('listarPlantillas falla ruidoso en 401 (no traga el error)', async () => {
  const http = httpFalsoGet([{ status: 401, data: { error: { code: 'x' } } }]);
  await assert.rejects(() => listarPlantillas({ http }), (err) => {
    assert.equal(err.codigo, 'x');
    return true;
  });
});
