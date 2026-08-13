'use strict';
const { Op } = require('sequelize');
const { Conversacion, Contacto } = require('../models');
const { ESTADO_CONVERSACION, ROL_AGENTE } = require('../config/constants');

const ABIERTAS = [ESTADO_CONVERSACION.NUEVA, ESTADO_CONVERSACION.ABIERTA, ESTADO_CONVERSACION.PENDIENTE];

/** El modo "ver ocultos" solo aplica a la bandeja Todos (admin). */
function esModoOcultos(bandeja, ocultos) {
  return !!ocultos && bandeja === 'todos';
}

function construirFiltro({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, ocultos = false }) {
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
  // Visibilidad: normal excluye archivadas; modo "ocultos" (solo Todos, admin) invierte.
  if (esModoOcultos(bandeja, ocultos)) {
    where[Op.or] = [
      { archivadaEn: { [Op.ne]: null } },
      { '$contacto.desactivado_en$': { [Op.ne]: null } },
    ];
  } else {
    where.archivadaEn = null;
  }
  return where;
}

function puedeVer(agente, conv) {
  if (agente.rol === ROL_AGENTE.ADMINISTRADOR) return true;
  return conv.agenteId === agente.id || conv.agenteId === null;
}

async function listar({ bandeja = 'mias', agenteSolicitante, agenteFiltro = null, q = null, soloNoLeidos = false, ocultos = false, pagina = 0, tam = 25 }) {
  const where = construirFiltro({ bandeja, agenteSolicitante, agenteFiltro, ocultos });
  const ocultosEfectivo = esModoOcultos(bandeja, ocultos);
  if (soloNoLeidos) where.noLeidos = { [Op.gt]: 0 };
  const orden = bandeja === 'general'
    ? [['ultimoMensajeEn', 'ASC']]
    : [['ultimoMensajeEn', 'DESC']];
  const contacto = {
    model: Contacto,
    as: 'contacto',
    required: true,
    attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay', 'desactivadoEn', 'compro', 'gestionarConIa'],
  };
  // En modo normal se excluyen los contactos desactivados; en "ocultos" se incluyen
  // (la condición de desactivado ya va en el Op.or del where). Usa la MISMA condición
  // que construirFiltro (esModoOcultos) para no depender del `ocultos` crudo del query.
  if (!ocultosEfectivo) contacto.where = { desactivadoEn: null };
  if (q) {
    contacto.where = {
      ...(contacto.where || {}),
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
async function contarBandejas({ agenteSolicitante, agenteFiltro = null }) {
  const esAdmin = agenteSolicitante.rol === ROL_AGENTE.ADMINISTRADOR;
  const bandejas = ['mias', 'general', 'resueltos', ...(esAdmin ? ['todos'] : [])];
  // "Todos" cuenta solo activas (y respeta el filtro por asesor si lo hay); el
  // resto usa el filtro normal de la bandeja (siempre del agente que consulta).
  const whereDe = (b) => {
    if (b !== 'todos') return construirFiltro({ bandeja: b, agenteSolicitante });
    const w = { estado: { [Op.in]: ABIERTAS }, archivadaEn: null };
    if (agenteFiltro) w.agenteId = agenteFiltro;
    return w;
  };
  const contactoActivo = { model: Contacto, as: 'contacto', required: true, where: { desactivadoEn: null }, attributes: [] };
  const cuenta = (where) => Conversacion.count({ where, include: [contactoActivo] });

  const total = {};
  const noLeidos = {};
  await Promise.all(bandejas.flatMap((b) => {
    const where = whereDe(b);
    return [
      cuenta(where).then((n) => { total[b] = n; }),
      cuenta({ ...where, noLeidos: { [Op.gt]: 0 } }).then((n) => { noLeidos[b] = n; }),
    ];
  }));
  return { ...total, noLeidos };
}

module.exports = { construirFiltro, puedeVer, listar, contarBandejas, esModoOcultos };
