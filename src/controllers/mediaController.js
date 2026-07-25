'use strict';

const { Mensaje, Conversacion } = require('../models');
const { puedeVer } = require('../services/conversaciones');
const { rutaMediaSegura } = require('../services/media');
const env = require('../config/env');
const logger = require('../utils/logger');

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
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
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

module.exports = { servir };
