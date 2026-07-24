'use strict';

/**
 * Ingesta: convierte un evento crudo de wa_eventos_webhook en contacto,
 * conversación, mensaje y actualizaciones de estado. Todo dentro de UNA
 * transacción por evento.
 *
 * Invariantes respetadas:
 *  - Idempotencia por wa_message_id (findOrCreate): reprocesar no duplica.
 *  - Orden por ts_proveedor para los desnormalizados.
 *  - Los acks nunca retroceden de estado.
 */

const { sequelize, Canal, Agente, Contacto, Conversacion, Mensaje, Asignacion } = require('../models');
const { normalizarEvento } = require('./normalizador');
const { cascada } = require('./asignacion');
const logger = require('../utils/logger');
const {
  ESTADO_CONVERSACION,
  ORIGEN_CONVERSACION,
  DIRECCION,
  ESTADO_MENSAJE,
  ORDEN_ESTADO_MENSAJE,
  TIPO_MENSAJE,
  VENTANA_24H_MS,
  ERROR_1MSG,
} = require('../config/constants');

/** '573001112233@c.us' → '573001112233' */
function telefonoDeWaId(waId) {
  return String(waId || '').split('@')[0].replace(/\D/g, '');
}

/** Etiqueta corta para el desnormalizado ultimo_mensaje_texto cuando es media. */
function etiquetaMedia(tipo) {
  return (
    {
      [TIPO_MENSAJE.IMAGE]: '[imagen]',
      [TIPO_MENSAJE.AUDIO]: '[audio]',
      [TIPO_MENSAJE.VIDEO]: '[video]',
      [TIPO_MENSAJE.DOCUMENT]: '[documento]',
      [TIPO_MENSAJE.STICKER]: '[sticker]',
    }[tipo] || '[media]'
  );
}

/** Fechas vuelven como string (dateStrings). Normaliza a Date para comparar. */
function aDate(v) {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

async function resolverCanalId(instanceId, transaction) {
  const inst = instanceId || process.env.ONEMSG_INSTANCE_ID;
  const [canal] = await Canal.findOrCreate({
    where: { instanceId: inst },
    defaults: { instanceId: inst, nombre: `Canal ${inst}`, telefono: '', tokenRef: 'env:ONEMSG_TOKEN' },
    transaction,
  });
  return canal.id;
}

async function resolverContacto(norm, transaction) {
  const waId = norm.waIdContacto;
  const [contacto, creado] = await Contacto.findOrCreate({
    where: { waId },
    defaults: { waId, telefono: telefonoDeWaId(waId), nombreWa: norm.nombreWa || null },
    transaction,
  });
  if (!creado && norm.nombreWa && !contacto.nombreWa) {
    contacto.nombreWa = norm.nombreWa;
    await contacto.save({ transaction });
  }
  return { contacto, creado };
}

async function resolverConversacion(contacto, norm, canalId, transaction) {
  const ultima = await Conversacion.findOne({
    where: { contactoId: contacto.id },
    order: [['id', 'DESC']],
    transaction,
  });
  if (ultima && ultima.estado !== ESTADO_CONVERSACION.CERRADA) {
    return { conv: ultima, creada: false };
  }

  const asig = await cascada(contacto, { Agente, transaction });
  const conv = await Conversacion.create(
    {
      canalId,
      contactoId: contacto.id,
      agenteId: asig.agenteId,
      estado: asig.agenteId ? ESTADO_CONVERSACION.ABIERTA : ESTADO_CONVERSACION.NUEVA,
      origen: norm.direccion === DIRECCION.IN ? ORIGEN_CONVERSACION.ENTRANTE : ORIGEN_CONVERSACION.SALIENTE,
    },
    { transaction },
  );
  await Asignacion.create(
    {
      conversacionId: conv.id,
      deAgenteId: null,
      aAgenteId: asig.agenteId,
      tipo: asig.tipo,
      ejecutadoPorId: null,
      motivo: asig.motivo,
    },
    { transaction },
  );
  return { conv, creada: true };
}

async function insertarMensaje(conv, norm, transaction) {
  let respondeAId = null;
  if (norm.respondeAWaId) {
    const orig = await Mensaje.findOne({
      where: { waMessageId: norm.respondeAWaId },
      attributes: ['id'],
      transaction,
    });
    if (orig) respondeAId = orig.id;
  }

  // Sin wa_message_id no hay clave de idempotencia: creamos directo (raro).
  if (!norm.waMessageId) {
    await Mensaje.create(
      {
        conversacionId: conv.id,
        direccion: norm.direccion,
        tipo: norm.tipo,
        texto: norm.texto,
        respondeAId,
        estado: ESTADO_MENSAJE.PENDIENTE,
        tsProveedor: norm.tsProveedor,
      },
      { transaction },
    );
    return { creado: true };
  }

  const [, creado] = await Mensaje.findOrCreate({
    where: { waMessageId: norm.waMessageId },
    defaults: {
      conversacionId: conv.id,
      waMessageId: norm.waMessageId,
      direccion: norm.direccion,
      tipo: norm.tipo,
      texto: norm.texto,
      respondeAId,
      estado: ESTADO_MENSAJE.PENDIENTE,
      tsProveedor: norm.tsProveedor,
    },
    transaction,
  });
  // NOTA: la descarga de media (tipo con mediaUrl) es la tarea 5; aquí solo se
  // registra el mensaje. Las URLs de media de 1msg expiran en ~5 min.
  return { creado };
}

async function actualizarDesnormalizados(conv, norm, transaction) {
  const ts = norm.tsProveedor || new Date();
  const prev = aDate(conv.ultimoMensajeEn);
  const cambios = {};

  if (!prev || ts.getTime() >= prev.getTime()) {
    cambios.ultimoMensajeEn = ts;
    cambios.ultimoMensajeTexto = (norm.esMedia ? etiquetaMedia(norm.tipo) : norm.texto || '').slice(0, 255);
    cambios.ultimoMensajeDir = norm.direccion;
  }
  if (norm.direccion === DIRECCION.IN) {
    cambios.noLeidos = (conv.noLeidos || 0) + 1;
    cambios.ventanaExpiraEn = new Date(ts.getTime() + VENTANA_24H_MS);
  }
  if (Object.keys(cambios).length) await conv.update(cambios, { transaction });
}

async function aplicarReglaError(norm, transaction) {
  if (!norm.errorCodigo || !norm.waIdContacto) return;
  const contacto = await Contacto.findOne({ where: { waId: norm.waIdContacto }, transaction });
  if (!contacto) return;
  if (norm.errorCodigo === ERROR_1MSG.EXPERIMENTO) {
    contacto.waExperimento = true;
    await contacto.save({ transaction });
  } else if (norm.errorCodigo === ERROR_1MSG.LIMITE_MARKETING) {
    contacto.marketingBloqueadoHasta = new Date(Date.now() + VENTANA_24H_MS);
    await contacto.save({ transaction });
  }
}

async function procesarAck(norm, transaction) {
  if (!norm.waMessageId) return { aplicado: false, motivo: 'sin id' };
  const msg = await Mensaje.findOne({ where: { waMessageId: norm.waMessageId }, transaction });
  if (!msg) {
    // Ack de un mensaje que no tenemos (p.ej. difusión). Fase posterior.
    return { aplicado: false, motivo: 'mensaje no encontrado' };
  }

  const cambios = {};
  if (norm.estado === ESTADO_MENSAJE.FALLIDO) {
    // No pisar un estado de entrega ya avanzado con un fallo tardío incoherente.
    if (msg.estado !== ESTADO_MENSAJE.ENTREGADO && msg.estado !== ESTADO_MENSAJE.LEIDO) {
      cambios.estado = ESTADO_MENSAJE.FALLIDO;
    }
    cambios.errorCodigo = norm.errorCodigo;
    cambios.errorDetalle = (norm.errorTexto || '').slice(0, 255);
  } else if (norm.estado) {
    // Progresión pendiente→enviado→entregado→leido: nunca retroceder.
    const actual = ORDEN_ESTADO_MENSAJE.indexOf(msg.estado);
    const nuevo = ORDEN_ESTADO_MENSAJE.indexOf(norm.estado);
    if (nuevo > actual) cambios.estado = norm.estado;
  }
  if (Object.keys(cambios).length) await msg.update(cambios, { transaction });

  await aplicarReglaError(norm, transaction);
  return { aplicado: true };
}

/**
 * Procesa un evento de wa_eventos_webhook. Con dryRun=true hace todo el trabajo
 * pero revierte la transacción al final (para validar sin escribir).
 * Devuelve un resumen de lo que hizo (o haría).
 */
async function procesarEventoWebhook(eventoRow, { dryRun = false } = {}) {
  const payload = typeof eventoRow.payload === 'string' ? JSON.parse(eventoRow.payload) : eventoRow.payload;
  const ev = normalizarEvento(payload);
  const resumen = { clase: ev.clase, mensajes: 0, contactosNuevos: 0, convNuevas: 0, acks: 0, acksAplicados: 0 };

  const t = await sequelize.transaction();
  try {
    const canalId = await resolverCanalId(ev.instanceId, t);

    if (ev.clase === 'mensajes') {
      for (const norm of ev.mensajes) {
        if (!norm.waIdContacto) continue;
        const { contacto, creado: contactoNuevo } = await resolverContacto(norm, t);
        if (contactoNuevo) resumen.contactosNuevos += 1;
        const { conv, creada } = await resolverConversacion(contacto, norm, canalId, t);
        if (creada) resumen.convNuevas += 1;
        const { creado } = await insertarMensaje(conv, norm, t);
        if (creado) {
          await actualizarDesnormalizados(conv, norm, t);
          resumen.mensajes += 1;
        }
      }
    } else if (ev.clase === 'acks') {
      for (const norm of ev.acks) {
        const r = await procesarAck(norm, t);
        resumen.acks += 1;
        if (r.aplicado) resumen.acksAplicados += 1;
      }
    }

    if (dryRun) await t.rollback();
    else await t.commit();
    return resumen;
  } catch (err) {
    await t.rollback();
    logger.error(`Ingesta falló para evento ${eventoRow.id}: ${err.message}`);
    throw err;
  }
}

module.exports = { procesarEventoWebhook };
