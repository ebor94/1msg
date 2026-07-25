'use strict';
const { Op } = require('sequelize');
const { Conversacion, Contacto } = require('../models');
const { ESTADO_CONVERSACION, ROL_AGENTE } = require('../config/constants');

const ABIERTAS = [ESTADO_CONVERSACION.NUEVA, ESTADO_CONVERSACION.ABIERTA, ESTADO_CONVERSACION.PENDIENTE];

function construirFiltro({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null }) {
  const where = {};
  if (bandeja === 'general') {
    where.agenteId = null;
    where.estado = { [Op.in]: ABIERTAS };
  } else if (bandeja === 'todos') {
    if (agenteSolicitante.rol !== ROL_AGENTE.ADMINISTRADOR) {
      const e = new Error('solo administradores pueden ver todos');
      e.status = 403;
      throw e;
    }
    if (agenteFiltro) where.agenteId = agenteFiltro;
  } else {
    where.agenteId = agenteSolicitante.id;
  }
  return where;
}

function puedeVer(agente, conv) {
  if (agente.rol === ROL_AGENTE.ADMINISTRADOR) return true;
  return conv.agenteId === agente.id || conv.agenteId === null;
}

async function listar({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, q = null, soloNoLeidos = false, pagina = 0, tam = 25 }) {
  const where = construirFiltro({ bandeja, agenteSolicitante, agenteFiltro });
  if (soloNoLeidos) where.noLeidos = { [Op.gt]: 0 };
  const orden = bandeja === 'general'
    ? [['ultimoMensajeEn', 'ASC']]
    : [['ultimoMensajeEn', 'DESC']];
  const contacto = {
    model: Contacto,
    as: 'contacto',
    required: true,
    attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay'],
  };
  if (q) {
    contacto.where = {
      [Op.or]: [
        { nombreDisplay: { [Op.like]: `%${q}%` } },
        { nombreWa: { [Op.like]: `%${q}%` } },
        { telefono: { [Op.like]: `%${q}%` } },
      ],
    };
  }
  const { rows, count } = await Conversacion.findAndCountAll({
    where,
    include: [contacto],
    order: orden,
    limit: tam,
    offset: pagina * tam,
  });
  return { total: count, pagina, conversaciones: rows };
}

module.exports = { construirFiltro, puedeVer, listar };
