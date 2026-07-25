'use strict';

const { Mensaje, Conversacion } = require('../models');
const { puedeVer } = require('../services/conversaciones');
const { rutaMediaSegura } = require('../services/media');
const { resolver } = require('../services/mediaPublica');
const env = require('../config/env');
const { TIPO_MENSAJE } = require('../config/constants');
const logger = require('../utils/logger');

/** Solo estos se muestran embebidos; el resto (documentos) se fuerza a descarga. */
const TIPOS_INLINE = new Set([TIPO_MENSAJE.IMAGE, TIPO_MENSAJE.STICKER, TIPO_MENSAJE.AUDIO, TIPO_MENSAJE.VIDEO]);

/** GET /api/mensajes/:id/media — sirve el archivo guardado si el agente puede ver la conversación. */
async function servir(req, res) {
  try {
    const msg = await Mensaje.findByPk(req.params.id, {
      include: [{ model: Conversacion, as: 'conversacion' }],
    });
    if (!msg) return res.status(404).json({ error: 'no encontrado' });
    if (!msg.conversacion || !puedeVer(req.agente, msg.conversacion)) {
      return res.status(403).json({ error: 'sin acceso' });
    }
    if (!msg.mediaRuta) return res.status(404).json({ error: 'sin archivo' });

    const abs = rutaMediaSegura(msg.mediaRuta, env.media.path);
    if (!abs) return res.status(404).json({ error: 'sin archivo' });

    const nombre = String(msg.mediaNombre || 'archivo').replace(/["\\\r\n]/g, '_');
    // Documentos (HTML/SVG/etc. de terceros) se fuerzan a descarga; media embebible va inline.
    const disposicion = TIPOS_INLINE.has(msg.tipo) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposicion}; filename="${nombre}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');

    return res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'sin archivo' });
    });
  } catch (err) {
    logger.error(`servir media ${req.params.id}: ${err.message}`);
    if (!res.headersSent) return res.status(500).json({ error: 'error interno' });
    return undefined;
  }
}

/** GET /media-publico/:token — sirve el archivo por token efímero (para que Meta lo descargue). */
async function servirPublico(req, res) {
  try {
    const e = resolver(req.params.token);
    if (!e) return res.status(404).json({ error: 'no disponible' });
    const abs = rutaMediaSegura(e.rutaRelativa, env.media.path);
    if (!abs) return res.status(404).json({ error: 'no disponible' });
    res.setHeader('Content-Type', e.mime || 'application/octet-stream');
    // Ruta pública sin auth en el mismo origen que la SPA: se fuerza descarga y
    // nosniff para que un archivo subido (HTML/SVG) no ejecute script en el origen.
    // Meta descarga el body igual (attachment no le estorba).
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(abs, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'no disponible' }); });
  } catch (err) {
    logger.error(`media-publico: ${err.message}`);
    if (!res.headersSent) return res.status(500).json({ error: 'error interno' });
    return undefined;
  }
}

module.exports = { servir, servirPublico };
