'use strict';
const { Contacto } = require('../models');
const logger = require('../utils/logger');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

async function crear(req, res) {
  const telefono = soloDigitos(req.body && req.body.telefono);
  const nombre = (req.body && req.body.nombre ? String(req.body.nombre) : '').trim();
  if (telefono.length < 10) return res.status(400).json({ error: 'teléfono inválido' });
  const waId = `${telefono}@c.us`;
  try {
    const existente = await Contacto.findOne({ where: { waId } });
    if (existente) return res.status(409).json({ error: 'el contacto ya existe', codigo: 'existe' });
    const contacto = await Contacto.create({
      waId, telefono, nombreDisplay: nombre || null, agenteDuenoId: req.agente.id,
    });
    return res.status(201).json({ contacto });
  } catch (err) {
    // Carrera: dos creaciones del mismo número a la vez → el índice único salta.
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'el contacto ya existe', codigo: 'existe' });
    }
    logger.error(`crear contacto: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { crear };
