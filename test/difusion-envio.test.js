'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { payloadDeEnvio } = require('../src/services/difusionEnvio');

const def = { name: 'recordatorio_de_mora', cuerpo: 'Hola {{1}}, mora {{2}}', variables: 2, tieneImagen: false, imagenDefault: null, namespace: 'ns', language: 'es' };

test('payloadDeEnvio arma phone, template y params de cuerpo', () => {
  const dif = { plantillaNombre: 'recordatorio_de_mora', plantillaIdioma: 'es', imagenUrl: null };
  const dest = { telefono: '573001234567', parametros: ['Juan', '$450.000'] };
  const p = payloadDeEnvio(dif, def, dest);
  assert.equal(p.phone, '573001234567');
  assert.equal(p.template, 'recordatorio_de_mora');
  assert.deepEqual(p.language, { code: 'es', policy: 'deterministic' });
  assert.equal(p.namespace, 'ns');
  // params = [ body con 2 textos ]
  assert.equal(p.params[0].type, 'body');
  assert.deepEqual(p.params[0].parameters.map((x) => x.text), ['Juan', '$450.000']);
});
test('payloadDeEnvio añade header de imagen si la plantilla la lleva', () => {
  const defImg = { ...def, tieneImagen: true, imagenDefault: 'https://x/y.png' };
  const dif = { plantillaNombre: 'promo', plantillaIdioma: 'es', imagenUrl: 'https://mi/persistente.png' };
  const p = payloadDeEnvio(dif, defImg, { telefono: '573001234567', parametros: ['Ana', '$1'] });
  assert.equal(p.params[0].type, 'header');
  assert.equal(p.params[0].parameters[0].image.link, 'https://mi/persistente.png'); // imagenUrl gana sobre default
});
