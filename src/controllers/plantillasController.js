'use strict';
const { listarPlantillas } = require('../integrations/onemsg/plantillas');
const { parsearPlantilla } = require('../services/plantillas');
const logger = require('../utils/logger');

let cache = { en: 0, datos: null };
const TTL = 5 * 60 * 1000;

async function listar(req, res) {
  try {
    const ahora = Date.now();
    if (!cache.datos || ahora - cache.en > TTL) {
      const crudas = await listarPlantillas();
      cache = { en: ahora, datos: crudas.map(parsearPlantilla) };
    }
    return res.json({ plantillas: cache.datos });
  } catch (err) {
    logger.error(`listar plantillas: ${err.message}`);
    return res.status(502).json({ error: 'no se pudieron traer las plantillas' });
  }
}

module.exports = { listar };
