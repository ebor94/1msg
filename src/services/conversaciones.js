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
  } else if (bandeja === 'resueltos') {
    where.agenteId = agenteSolicitante.id;
    where.estado = ESTADO_CONVERSACION.CERRADA;
  } else {
    where.agenteId = agenteSolicitante.id;
    where.estado = { [Op.in]: ABIERTAS };
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

/**
 * Cuenta los chats de cada bandeja para los badges de las pestañas. Usa los
 * mismos filtros que `listar` (COUNT por bandeja, sin traer filas). `todos` solo
 * para administradores.
 */
async function contarBandejas({ agenteSolicitante }) {
  const cuenta = (bandeja) => Conversacion.count({ where: construirFiltro({ bandeja, agenteSolicitante }) });
  const [mias, general, resueltos] = await Promise.all([cuenta('mias'), cuenta('general'), cuenta('resueltos')]);
  const out = { mias, general, resueltos };
  // "Todos": solo las activas (nueva/abierta/pendiente), no las resueltas.
  if (agenteSolicitante.rol === ROL_AGENTE.ADMINISTRADOR) {
    out.todos = await Conversacion.count({ where: { estado: { [Op.in]: ABIERTAS } } });
  }
  return out;
}

module.exports = { construirFiltro, puedeVer, listar, contarBandejas };
