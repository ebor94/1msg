'use strict';
const logger = require('../utils/logger');
const servicioReal = require('../services/recordatorios');

let servicio = servicioReal;
function _setServicio(s) { servicio = { ...servicioReal, ...s }; }

async function obtener(req, res) {
  try {
    return res.json({ recordatorio: await servicio.recordatorioDeContacto(req.params.id) });
  } catch (err) {
    logger.error(`recordatorio obtener (${req.params.id}): ${err.message}`);
    return res.status(500).json({ error: 'no se pudo obtener el recordatorio' });
  }
}

async function guardar(req, res) {
  try {
    const { activo, diaMes } = req.body || {};
    const r = await servicio.guardarRecordatorio(req.params.id, { activo: !!activo, diaMes }, req.agente);
    return res.json({ recordatorio: r });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error(`recordatorio guardar (${req.params.id}): ${err.message}`);
    return res.status(500).json({ error: 'no se pudo guardar el recordatorio' });
  }
}

module.exports = { obtener, guardar, _setServicio };
