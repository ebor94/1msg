'use strict';
const { Op } = require('sequelize');
const { Conversacion, Mensaje } = require('../models');
const { listar, puedeVer } = require('../services/conversaciones');
const logger = require('../utils/logger');

async function accesible(req, res) {
  const conv = await Conversacion.findByPk(req.params.id);
  if (!conv) { res.status(404).json({ error: 'no encontrada' }); return null; }
  if (!puedeVer(req.agente, conv)) { res.status(403).json({ error: 'sin acceso' }); return null; }
  return conv;
}

async function listarHandler(req, res) {
  try {
    const r = await listar({
      bandeja: req.query.bandeja,
      agenteSolicitante: req.agente,
      agenteFiltro: req.query.agente ? Number(req.query.agente) : null,
      q: req.query.q || null,
      pagina: Number(req.query.pagina) || 0,
    });
    return res.json(r);
  } catch (err) {
    logger.error(`listar conversaciones: ${err.message}`);
    return res.status(err.status || 500).json({ error: err.message });
  }
}

async function mensajes(req, res) {
  const conv = await accesible(req, res);
  if (!conv) return undefined;
  const where = { conversacionId: conv.id };
  if (req.query.antesDe) where.id = { [Op.lt]: Number(req.query.antesDe) };
  const filas = await Mensaje.findAll({ where, order: [['tsProveedor', 'DESC'], ['id', 'DESC']], limit: 30 });
  return res.json({ mensajes: filas.reverse() });
}

async function leer(req, res) {
  const conv = await accesible(req, res);
  if (!conv) return undefined;
  await Conversacion.update({ noLeidos: 0 }, { where: { id: conv.id } });
  return res.json({ ok: true });
}

module.exports = { listarHandler, mensajes, leer };
