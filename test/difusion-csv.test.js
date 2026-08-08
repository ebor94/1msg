'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarTelefonoCo, parsearCsv, validarColumnas, construirDestinatarios } = require('../src/services/difusionCsv');

test('validarTelefonoCo acepta celular de 10 dígitos y normaliza a 57...', () => {
  assert.deepEqual(validarTelefonoCo('3001234567'), { ok: true, waId: '573001234567@c.us', telefono: '573001234567' });
  assert.deepEqual(validarTelefonoCo('57 300 123 4567'), { ok: true, waId: '573001234567@c.us', telefono: '573001234567' });
});
test('validarTelefonoCo rechaza fijo/corto', () => {
  assert.equal(validarTelefonoCo('6017654321').ok, false); // no empieza en 3
  assert.equal(validarTelefonoCo('12345').ok, false);
});
test('parsearCsv separa cabeceras y filas', () => {
  const r = parsearCsv('CELULAR,NOMBRE\n3001234567,Juan\n3009876543,Ana');
  assert.deepEqual(r.cabeceras, ['CELULAR', 'NOMBRE']);
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[0].NOMBRE, 'Juan');
});
test('validarColumnas lanza 400 si falta una columna mapeada', () => {
  const mapeo = { telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [{ tipo: 'columna', columna: 'NOMBRE' }] };
  assert.throws(() => validarColumnas(['CELULAR', 'NOMBRE'], mapeo), (e) => e.status === 400); // falta AGENTE_ID
});
test('construirDestinatarios: válido, teléfono malo, agente inactivo, y orden de parámetros', () => {
  const mapeo = {
    telefono: 'CELULAR', agente: 'AGENTE_ID',
    variables: [{ tipo: 'columna', columna: 'NOMBRE' }, { tipo: 'fijo', valor: '$450.000' }],
  };
  const filas = [
    { CELULAR: '3001234567', NOMBRE: 'Juan', AGENTE_ID: '5' },
    { CELULAR: '601000', NOMBRE: 'Fijo', AGENTE_ID: '5' },
    { CELULAR: '3009876543', NOMBRE: 'Ana', AGENTE_ID: '99' },
  ];
  const out = construirDestinatarios({ filas, mapeo, agentesActivos: [5] });
  assert.equal(out[0].estado, 'pendiente');
  assert.deepEqual(out[0].parametros, ['Juan', '$450.000']);
  assert.equal(out[0].agenteId, 5);
  assert.equal(out[0].nombre, 'Juan'); // nombre del contacto tomado de la columna NOMBRE
  assert.equal(out[1].estado, 'omitido'); assert.match(out[1].motivo, /telefono/);
  assert.equal(out[2].estado, 'omitido'); assert.match(out[2].motivo, /agente/);
});
