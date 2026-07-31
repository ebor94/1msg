'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarEvento, codigoDeError, aFecha } = require('../src/services/normalizador');

// Estructuras tomadas de tráfico real (docs/payloads-reales-1msg.md), con datos
// personales sustituidos por valores de prueba.

test('mensaje de texto entrante (type chat)', () => {
  const ev = normalizarEvento({
    instanceId: 'VID1',
    messages: [
      {
        id: 'ABC1',
        type: 'chat',
        body: 'Hola, necesito info',
        self: 0,
        fromMe: false,
        time: '1753370400',
        chatId: '573001112233@c.us',
        senderName: 'Cliente',
        authorBsuid: 'CO.1726691741709890',
        quotedMsgId: null,
      },
    ],
  });
  assert.equal(ev.clase, 'mensajes');
  assert.equal(ev.instanceId, 'VID1');
  const m = ev.mensajes[0];
  assert.equal(m.waMessageId, 'ABC1');
  assert.equal(m.tipo, 'text');
  assert.equal(m.direccion, 'in');
  assert.equal(m.texto, 'Hola, necesito info');
  assert.equal(m.mediaUrl, null);
  assert.equal(m.esMedia, false);
  assert.equal(m.waIdContacto, '573001112233@c.us');
  assert.equal(m.bsuid, 'CO.1726691741709890');
  assert.deepEqual(m.tsProveedor, new Date(1753370400 * 1000));
});

test('mensaje saliente (fromMe/self) → direccion out y nombreWa null', () => {
  const ev = normalizarEvento({
    messages: [{ id: 'X', type: 'chat', body: 'Respuesta', self: 1, fromMe: true, time: '1', senderName: '573176652197@c.us' }],
  });
  assert.equal(ev.mensajes[0].direccion, 'out');
  // El senderName de un saliente es la empresa: nunca es el nombre del contacto.
  assert.equal(ev.mensajes[0].nombreWa, null);
});

test('mensaje con media (document): body es URL, caption es texto', () => {
  const ev = normalizarEvento({
    messages: [
      {
        id: 'DOC1',
        type: 'document',
        body: 'https://s3.eu-central-1.wasabisys.com/onemessageapp/x.pdf',
        caption: 'el acta',
        fromMe: true,
        time: '1753370520',
        chatId: '57300@c.us',
      },
    ],
  });
  const m = ev.mensajes[0];
  assert.equal(m.tipo, 'document');
  assert.equal(m.esMedia, true);
  assert.equal(m.mediaUrl, 'https://s3.eu-central-1.wasabisys.com/onemessageapp/x.pdf');
  assert.equal(m.texto, 'el acta');
});

test('respuesta: quotedMsgId → respondeAWaId', () => {
  const ev = normalizarEvento({ messages: [{ id: 'R', type: 'chat', body: 'ok', quotedMsgId: 'ORIG1', time: '1' }] });
  assert.equal(ev.mensajes[0].respondeAWaId, 'ORIG1');
});

test('type desconocido → system', () => {
  const ev = normalizarEvento({ messages: [{ id: 'S', type: 'algo_raro', body: 'x', time: '1' }] });
  assert.equal(ev.mensajes[0].tipo, 'system');
});

test('ack: status → estado', () => {
  const ev = normalizarEvento({
    instanceId: 'VID1',
    ack: [{ id: 'ABC1', chatId: '57300@c.us', status: 'delivered' }],
  });
  assert.equal(ev.clase, 'acks');
  const a = ev.acks[0];
  assert.equal(a.waMessageId, 'ABC1');
  assert.equal(a.estado, 'entregado');
  assert.equal(a.errorCodigo, null);
});

test('ack fallido por experimento → 130472', () => {
  const ev = normalizarEvento({
    ack: [{ id: 'F1', status: 'failed', error: "User's number is part of an experiment" }],
  });
  const a = ev.acks[0];
  assert.equal(a.estado, 'fallido');
  assert.equal(a.errorCodigo, '130472');
  assert.equal(a.errorTexto, "User's number is part of an experiment");
});

test('codigoDeError mapea textos conocidos', () => {
  assert.equal(codigoDeError('User is part of an experiment'), '130472');
  assert.equal(codigoDeError('some random error'), null);
  assert.equal(codigoDeError(null), null);
});

test('aFecha: unix segundos → Date; vacío → null', () => {
  assert.deepEqual(aFecha('1753370400'), new Date(1753370400000));
  assert.equal(aFecha(null), null);
  assert.equal(aFecha(''), null);
});

test('evento desconocido (ni messages ni ack)', () => {
  const ev = normalizarEvento({ instanceId: 'V', foo: 1 });
  assert.equal(ev.clase, 'desconocido');
  assert.equal(ev.mensajes.length, 0);
  assert.equal(ev.acks.length, 0);
});
