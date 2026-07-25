'use strict';
const { Agente } = require('../models');
const logger = require('../utils/logger');

async function listar(req, res) {
  try {
    const filas = await Agente.findAll({
      where: { activo: true },
      attributes: ['id', 'usuario', 'nombre', 'rol'],
      order: [['nombre', 'ASC']],
    });
    return res.json({ agentes: filas });
  } catch (err) {
    logger.error(`listar agentes: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar };
