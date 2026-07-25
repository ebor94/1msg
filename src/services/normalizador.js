'use strict';

/**
 * Normalizador de payloads de 1msg → nuestra forma de dominio.
 *
 * Son funciones PURAS (sin DB, sin efectos): fáciles de testear y de razonar.
 * El formato real de 1msg está documentado en docs/payloads-reales-1msg.md.
 *
 * Discriminador de evento: presencia de `messages[]` (mensajes) vs `ack[]`
 * (estados de entrega). No hay un `type` de nivel superior.
 */

const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ERROR_1MSG } = require('../config/constants');

/** type de 1msg → wa_mensajes.tipo. `chat` es texto. Desconocido → system. */
const TIPO_1MSG = Object.freeze({
  chat: TIPO_MENSAJE.TEXT,
  text: TIPO_MENSAJE.TEXT,
  image: TIPO_MENSAJE.IMAGE,
  audio: TIPO_MENSAJE.AUDIO,
  ptt: TIPO_MENSAJE.AUDIO, // nota de voz
  video: TIPO_MENSAJE.VIDEO,
  document: TIPO_MENSAJE.DOCUMENT,
  sticker: TIPO_MENSAJE.STICKER,
  location: TIPO_MENSAJE.LOCATION,
  contact: TIPO_MENSAJE.CONTACT,
  vcard: TIPO_MENSAJE.CONTACT,
  button: TIPO_MENSAJE.BUTTON,
  interactive: TIPO_MENSAJE.INTERACTIVE,
  reaction: TIPO_MENSAJE.REACTION,
});

/** Tipos que traen archivo: en ellos `body` es la URL y `caption` el texto. */
const TIPOS_MEDIA = new Set([
  TIPO_MENSAJE.IMAGE,
  TIPO_MENSAJE.AUDIO,
  TIPO_MENSAJE.VIDEO,
  TIPO_MENSAJE.DOCUMENT,
  TIPO_MENSAJE.STICKER,
]);

/** status de ack de 1msg → wa_mensajes.estado. */
const ESTADO_ACK = Object.freeze({
  sent: ESTADO_MENSAJE.ENVIADO,
  delivered: ESTADO_MENSAJE.ENTREGADO,
  read: ESTADO_MENSAJE.LEIDO,
  played: ESTADO_MENSAJE.LEIDO, // audios reproducidos = leído
  failed: ESTADO_MENSAJE.FALLIDO,
});

/**
 * El ack fallido trae `error` como TEXTO, no el código. Mapeamos por patrón.
 * Confirmado en producción: "experiment" → 130472. Los otros son tentativos
 * hasta verlos en tráfico real (ver docs/payloads-reales-1msg.md).
 */
const ERROR_TEXTO = Object.freeze([
  { re: /experiment/i, codigo: ERROR_1MSG.EXPERIMENTO }, // 130472
  { re: /healthy ecosystem|per[- ]?user|marketing.*limit|frequency cap/i, codigo: ERROR_1MSG.LIMITE_MARKETING }, // 131049
  { re: /outside.*window|re[- ]?engagement|24[- ]?hour|requires? a template/i, codigo: ERROR_1MSG.FUERA_DE_VENTANA }, // 131047
]);

/** Convierte un timestamp de 1msg (unix en segundos) a Date. Null si no hay. */
function aFecha(time) {
  if (time === undefined || time === null || time === '') return null;
  const seg = Number(time);
  if (Number.isNaN(seg)) return null;
  return new Date(seg * 1000);
}

/** Mapea el texto de error de un ack fallido a un código conocido, o null. */
function codigoDeError(textoError) {
  if (!textoError || typeof textoError !== 'string') return null;
  const encontrado = ERROR_TEXTO.find((e) => e.re.test(textoError));
  return encontrado ? encontrado.codigo : null;
}

/** Normaliza un objeto message de 1msg. */
function normalizarMensaje(m) {
  const tipo = TIPO_1MSG[m.type] || TIPO_MENSAJE.SYSTEM;
  const esMedia = TIPOS_MEDIA.has(tipo);
  const saliente = m.fromMe === true || m.self === 1 || m.self === true;

  return {
    waMessageId: m.id || null,
    waIdContacto: m.chatId || m.author || null,
    // Solo en ENTRANTES el senderName es el del cliente. En salientes es el
    // número propio de la empresa (echo), así que NO lo usamos como nombre del
    // contacto (si no, la campaña saliente le pone a todos el mismo "nombre").
    nombreWa: saliente ? null : m.senderName || m.chatName || null,
    direccion: saliente ? DIRECCION.OUT : DIRECCION.IN,
    tipo,
    esMedia,
    texto: esMedia ? m.caption || null : m.body || null,
    mediaUrl: esMedia ? m.body || null : null,
    tsProveedor: aFecha(m.time),
    respondeAWaId: m.quotedMsgId || null,
    esReenviado: m.isForwarded === true,
    raw: m,
  };
}

/** Normaliza un objeto ack de 1msg. */
function normalizarAck(a) {
  return {
    waMessageId: a.id || null,
    waIdContacto: a.chatId || null,
    estado: ESTADO_ACK[a.status] || null,
    errorTexto: a.error || null,
    errorCodigo: codigoDeError(a.error),
    raw: a,
  };
}

/**
 * Normaliza un evento completo del webhook.
 * Devuelve { clase, instanceId, mensajes[], acks[] }.
 * `clase`: 'mensajes' | 'acks' | 'desconocido'.
 */
function normalizarEvento(payload) {
  if (!payload || typeof payload !== 'object') {
    return { clase: 'desconocido', instanceId: null, mensajes: [], acks: [] };
  }
  const instanceId = payload.instanceId || null;

  if (Array.isArray(payload.messages)) {
    return {
      clase: 'mensajes',
      instanceId,
      mensajes: payload.messages.map(normalizarMensaje),
      acks: [],
    };
  }
  if (Array.isArray(payload.ack)) {
    return {
      clase: 'acks',
      instanceId,
      mensajes: [],
      acks: payload.ack.map(normalizarAck),
    };
  }
  return { clase: 'desconocido', instanceId, mensajes: [], acks: [] };
}

module.exports = {
  normalizarEvento,
  normalizarMensaje,
  normalizarAck,
  codigoDeError,
  aFecha,
  TIPO_1MSG,
  ESTADO_ACK,
  TIPOS_MEDIA,
};
