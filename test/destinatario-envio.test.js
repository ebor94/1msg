'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { destinatario1msg } = require('../src/services/envio');

test('contacto normal (@c.us) → se envía por chatId = waId', () => {
  const r = destinatario1msg({ waId: '573001234567@c.us', bsuid: null });
  assert.deepEqual(r, { chatId: '573001234567@c.us' });
});

test('contacto @lid con bsuid → se envía por phone = bsuid (sin @lid)', () => {
  const r = destinatario1msg({ waId: 'CO.1726691741709890@lid', bsuid: 'CO.1726691741709890' });
  assert.deepEqual(r, { phone: 'CO.1726691741709890' });
});

test('contacto @lid sin bsuid guardado → phone derivado del waId (quita @lid)', () => {
  const r = destinatario1msg({ waId: 'CO.1726691741709890@lid', bsuid: null });
  assert.deepEqual(r, { phone: 'CO.1726691741709890' });
});
