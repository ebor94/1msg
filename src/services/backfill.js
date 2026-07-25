'use strict';

const { paginaHistorial: paginaHistorialReal } = require('../integrations/onemsg/historial');
const { normalizarMensaje } = require('./normalizador');
const { guardarMediaDeMensaje: guardarMediaReal } = require('./media');
const { Mensaje: MensajeReal } = require('../models');
const { DIRECCION, ESTADO_MENSAJE } = require('../config/constants');
const logger = require('../utils/logger');

const LIMIT_DEFECTO = 100;
const MAX_PAGINAS = 500; // tope de seguridad: 500 * 100 = 50k mensajes
const CONCURRENCIA_MEDIA = 4;

async function enTandas(items, tam, fn) {
  for (let i = 0; i < items.length; i += tam) {
    await Promise.all(items.slice(i, i + tam).map(fn));
  }
}

/**
 * Recupera TODO el historial de un chat desde 1msg y lo guarda idempotente.
 * Corre una vez por conversación (marca historicoCargadoEn).
 */
async function recuperarHistorial(conv, deps = {}) {
  if (conv.historicoCargadoEn) return { yaRecuperado: true };

  const paginar = deps.paginaHistorial || paginaHistorialReal;
  const guardarMedia = deps.guardarMediaDeMensaje || guardarMediaReal;
  const Mensaje = deps.Mensaje || MensajeReal;
  const limit = deps.limit || LIMIT_DEFECTO;
  const chatId = conv.contacto.waId;

  let cursor = 0;
  let paginas = 0;
  let recuperados = 0;
  let mediaOk = 0;
  let mediaFallida = 0;

  while (paginas < MAX_PAGINAS) {
    const pagina = await paginar({ chatId, lastMessageNumber: cursor, limit });
    if (!pagina.length) break;

    const tareasMedia = [];
    for (const m of pagina) {
      const norm = normalizarMensaje(m);
      if (!norm.waMessageId) continue;
      const [inst, creado] = await Mensaje.findOrCreate({
        where: { waMessageId: norm.waMessageId },
        defaults: {
          conversacionId: conv.id,
          waMessageId: norm.waMessageId,
          direccion: norm.direccion,
          tipo: norm.tipo,
          texto: norm.texto,
          // Mensaje histórico: se asume entregado (no tenemos su ack).
          estado: norm.direccion === DIRECCION.OUT ? ESTADO_MENSAJE.ENTREGADO : ESTADO_MENSAJE.PENDIENTE,
          tsProveedor: norm.tsProveedor,
        },
      });
      if (creado) {
        recuperados += 1;
        if (norm.esMedia && norm.mediaUrl && !inst.mediaRuta) {
          tareasMedia.push({ mensajeId: inst.id, mediaUrl: norm.mediaUrl, conversacionId: conv.id, waMessageId: norm.waMessageId, fecha: norm.tsProveedor });
        }
      }
    }

    // Descargar la media de ESTA página antes de seguir: las URLs de 1msg expiran
    // (~5 min), así que la descarga debe ir cerca del fetch, no al final de todo.
    await enTandas(tareasMedia, CONCURRENCIA_MEDIA, async (t) => {
      try {
        const campos = await guardarMedia(t);
        if (campos) { await Mensaje.update(campos, { where: { id: t.mensajeId } }); mediaOk += 1; }
        else mediaFallida += 1;
      } catch (e) {
        mediaFallida += 1;
        logger.error(`backfill media msg ${t.mensajeId}: ${e.message}`);
      }
    });

    const nuevoCursor = Math.max(...pagina.map((x) => x.messageNumber || 0));
    paginas += 1;
    // Defensa: si el cursor no avanza (messageNumber ausente), cortar en vez de
    // re-pedir la misma página hasta el tope.
    if (nuevoCursor <= cursor) break;
    cursor = nuevoCursor;
    if (pagina.length < limit) break;
  }
  if (paginas >= MAX_PAGINAS) logger.warn(`backfill conv ${conv.id}: alcanzó el tope de ${MAX_PAGINAS} páginas`);

  await conv.update({ historicoCargadoEn: new Date() });
  return { recuperados, mediaOk, mediaFallida };
}

module.exports = { recuperarHistorial };
