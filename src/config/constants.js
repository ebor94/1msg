'use strict';

/**
 * Constantes de dominio derivadas del esquema (docs/esquema_bandeja.sql)
 * y de las reglas de negocio de CLAUDE.md. Un único lugar para los ENUM
 * y los códigos de error de 1msg, para no repetir literales por el código.
 */

// --- ENUM de las tablas wa_ ---

const ESTADO_CONVERSACION = Object.freeze({
  NUEVA: 'nueva',
  ABIERTA: 'abierta',
  PENDIENTE: 'pendiente',
  CERRADA: 'cerrada',
});

const ORIGEN_CONVERSACION = Object.freeze({
  ENTRANTE: 'entrante',
  SALIENTE: 'saliente',
  DIFUSION: 'difusion',
  CTWA: 'ctwa',
});

const DIRECCION = Object.freeze({
  IN: 'in',
  OUT: 'out',
});

const TIPO_MENSAJE = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  DOCUMENT: 'document',
  STICKER: 'sticker',
  LOCATION: 'location',
  CONTACT: 'contact',
  BUTTON: 'button',
  INTERACTIVE: 'interactive',
  TEMPLATE: 'template',
  REACTION: 'reaction',
  SYSTEM: 'system',
});

/**
 * Progresión de estados de entrega. El índice define el orden:
 * un ack nunca puede retroceder (regla de la tarea 6).
 */
const ESTADO_MENSAJE = Object.freeze({
  PENDIENTE: 'pendiente',
  ENVIADO: 'enviado',
  ENTREGADO: 'entregado',
  LEIDO: 'leido',
  FALLIDO: 'fallido',
});

const ORDEN_ESTADO_MENSAJE = Object.freeze([
  ESTADO_MENSAJE.PENDIENTE,
  ESTADO_MENSAJE.ENVIADO,
  ESTADO_MENSAJE.ENTREGADO,
  ESTADO_MENSAJE.LEIDO,
]);

const TIPO_ASIGNACION = Object.freeze({
  AUTO_CONTINUIDAD: 'auto_continuidad',
  AUTO_REGLA: 'auto_regla',
  AUTO_ROTACION: 'auto_rotacion',
  TOMA_MANUAL: 'toma_manual',
  REASIGNACION: 'reasignacion',
  DEVUELTA_GENERAL: 'devuelta_general',
  ESCALADO_BOT: 'escalado_bot',
});

// Roles propios de la bandeja (no son el rol_id de serfuweb):
//  administrador → ve todo y asigna chats; asesor → ve lo suyo + general.
const ROL_AGENTE = Object.freeze({
  ADMINISTRADOR: 'administrador',
  ASESOR: 'asesor',
});

// --- Códigos de error relevantes de 1msg / Meta (CLAUDE.md) ---

const ERROR_1MSG = Object.freeze({
  // Límite por destinatario de plantillas de marketing. Reintentar tras 24h.
  LIMITE_MARKETING: '131049',
  // Número en experimento de Meta. No reintentar nunca; marcar wa_experimento.
  EXPERIMENTO: '130472',
  // Fuera de la ventana de 24h, requiere plantilla.
  FUERA_DE_VENTANA: '131047',
});

// --- Reglas de tiempo ---

const VENTANA_24H_MS = 24 * 60 * 60 * 1000;

module.exports = {
  ESTADO_CONVERSACION,
  ORIGEN_CONVERSACION,
  DIRECCION,
  TIPO_MENSAJE,
  ESTADO_MENSAJE,
  ORDEN_ESTADO_MENSAJE,
  TIPO_ASIGNACION,
  ROL_AGENTE,
  ERROR_1MSG,
  VENTANA_24H_MS,
};
