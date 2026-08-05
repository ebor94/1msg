'use strict';
const logger = require('../utils/logger');
const servicio = require('../services/reporteAgentes');

// Dependencias inyectables (para test sin BD).
let deps = { metricasDelDia: servicio.metricasDelDia, backlogVivo: servicio.backlogVivo };
function _setDeps(d) { deps = { ...deps, ...d }; }

/** GET /api/reportes/agentes?fecha=YYYY-MM-DD — volumen + TPR del día. */
async function delDia(req, res) {
  try {
    const data = await deps.metricasDelDia(req.query.fecha);
    return res.json(data);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error(`reporte del día: ${err.message}`);
    return res.status(500).json({ error: 'no se pudo generar el reporte' });
  }
}

/** GET /api/reportes/agentes/vivo — backlog sin responder ahora mismo. */
async function vivo(req, res) {
  try {
    const data = await deps.backlogVivo();
    return res.json(data);
  } catch (err) {
    logger.error(`backlog vivo: ${err.message}`);
    return res.status(500).json({ error: 'no se pudo obtener el backlog' });
  }
}

module.exports = { delDia, vivo, _setDeps };
