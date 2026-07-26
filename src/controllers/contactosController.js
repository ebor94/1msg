'use strict';
const { Op } = require('sequelize');
const { Contacto, Conversacion, Asignacion, Canal, Agente } = require('../models');
const { sequelize } = require('../config/database');
const env = require('../config/env');
const { ESTADO_CONVERSACION, ORIGEN_CONVERSACION, TIPO_ASIGNACION } = require('../config/constants');
const logger = require('../utils/logger');
const { construirResultado } = require('../services/busquedaContactos');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

async function resolverCanalId(t) {
  const inst = env.onemsg.instanceId;
  const [canal] = await Canal.findOrCreate({
    where: { instanceId: inst },
    defaults: { instanceId: inst, nombre: `Canal ${inst}`, telefono: '', tokenRef: 'env:ONEMSG_TOKEN' },
    transaction: t,
  });
  return canal.id;
}

/**
 * Crea un contacto (dueño = el agente) Y una conversación nueva asignada a él,
 * para iniciar una conversación saliente. La ventana de 24h queda cerrada
 * (el cliente no ha escrito): el envío del primer mensaje requerirá plantilla.
 */
async function crear(req, res) {
  const telefono = soloDigitos(req.body && req.body.telefono);
  const nombre = (req.body && req.body.nombre ? String(req.body.nombre) : '').trim();
  if (telefono.length < 10) return res.status(400).json({ error: 'teléfono inválido' });
  const waId = `${telefono}@c.us`;
  try {
    const existente = await Contacto.findOne({ where: { waId } });
    if (existente) return res.status(409).json({ error: 'el contacto ya existe', codigo: 'existe' });

    const { contacto, conv } = await sequelize.transaction(async (t) => {
      const nuevoContacto = await Contacto.create(
        { waId, telefono, nombreDisplay: nombre || null, agenteDuenoId: req.agente.id },
        { transaction: t },
      );
      const canalId = await resolverCanalId(t);
      const nuevaConv = await Conversacion.create(
        {
          canalId,
          contactoId: nuevoContacto.id,
          agenteId: req.agente.id,
          estado: ESTADO_CONVERSACION.ABIERTA,
          origen: ORIGEN_CONVERSACION.SALIENTE,
        },
        { transaction: t },
      );
      await Asignacion.create(
        {
          conversacionId: nuevaConv.id,
          deAgenteId: null,
          aAgenteId: req.agente.id,
          tipo: TIPO_ASIGNACION.TOMA_MANUAL,
          ejecutadoPorId: req.agente.id,
          motivo: 'contacto creado por el agente',
        },
        { transaction: t },
      );
      return { contacto: nuevoContacto, conv: nuevaConv };
    });

    const conversacion = conv.toJSON();
    conversacion.contacto = contacto;
    return res.status(201).json({ contacto, conversacion });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'el contacto ya existe', codigo: 'existe' });
    }
    logger.error(`crear contacto: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * Buscador GLOBAL por nombre (nombre_wa/nombre_display) y/o teléfono (parcial,
 * sobre dígitos). Devuelve solo metadatos: dueño actual de la conversación (si
 * existe) y una `conversacion` lista para abrir en el frontend. No filtra por
 * agente: cualquier agente autenticado ve cualquier contacto (la bandeja decide
 * después si puede abrir la conversación).
 */
async function buscar(req, res) {
  const q = String(req.query.q ?? req.query.telefono ?? '').trim();
  const digitos = soloDigitos(q);
  const condiciones = [];
  if (q.length >= 2) {
    condiciones.push({ nombreDisplay: { [Op.like]: `%${q}%` } });
    condiciones.push({ nombreWa: { [Op.like]: `%${q}%` } });
  }
  if (digitos.length >= 3) {
    condiciones.push({ telefono: { [Op.like]: `%${digitos}%` } });
    condiciones.push({ waId: { [Op.like]: `%${digitos}%` } });
  }
  if (!condiciones.length) return res.json({ resultados: [] });
  try {
    const contactos = await Contacto.findAll({
      where: { [Op.or]: condiciones },
      attributes: ['id', 'waId', 'telefono', 'nombreWa', 'nombreDisplay', 'agenteDuenoId'],
      include: [{ model: Agente, as: 'agenteDueno', attributes: ['id', 'nombre'] }],
      limit: 10,
    });

    const resultados = [];
    for (const c of contactos) {
      const conv = await Conversacion.findOne({
        where: { contactoId: c.id },
        order: [['ultimoMensajeEn', 'DESC'], ['id', 'DESC']],
        include: [{ model: Agente, as: 'agente', attributes: ['id', 'nombre'] }],
      });
      resultados.push(construirResultado(c, conv, req.agente.id));
    }
    return res.json({ resultados });
  } catch (err) {
    logger.error(`buscar contactos: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** Forma plana del contacto que espera el frontend para pintar la cabecera del chat. */
function contactoPlano(c) {
  return {
    id: c.id,
    waId: c.waId,
    telefono: c.telefono,
    nombreWa: c.nombreWa,
    nombreDisplay: c.nombreDisplay,
  };
}

/**
 * POST /api/contactos/:id/conversacion — abre (crea) una conversación saliente
 * para un contacto que YA existe pero aún no tiene chat (típico de los importados
 * con dueño asignado). Idempotente: si ya hay conversación, la devuelve.
 *
 * Sin `tomar`: la conversación queda asignada al dueño del contacto
 * (`agente_dueno_id`); si no tiene dueño, al agente que la abre (que además pasa
 * a ser su dueño, por continuidad). Con `tomar: true`: se asigna a quien abre y
 * se lo queda (equivale a "tomar de otro" cuando el dueño es otro agente).
 */
async function abrir(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const tomar = !!(req.body && req.body.tomar);
  try {
    const contacto = await Contacto.findByPk(id);
    if (!contacto) return res.status(404).json({ error: 'contacto no encontrado' });

    // Idempotencia: si ya existe una conversación, se devuelve para abrir.
    const existente = await Conversacion.findOne({
      where: { contactoId: contacto.id },
      order: [['ultimoMensajeEn', 'DESC'], ['id', 'DESC']],
    });
    if (existente) {
      const conversacion = existente.toJSON();
      conversacion.contacto = contactoPlano(contacto);
      return res.json({ conversacion, creada: false });
    }

    const agenteId = tomar ? req.agente.id : (contacto.agenteDuenoId || req.agente.id);
    const conv = await sequelize.transaction(async (t) => {
      const canalId = await resolverCanalId(t);
      const nuevaConv = await Conversacion.create(
        {
          canalId,
          contactoId: contacto.id,
          agenteId,
          estado: ESTADO_CONVERSACION.ABIERTA,
          origen: ORIGEN_CONVERSACION.SALIENTE,
        },
        { transaction: t },
      );
      await Asignacion.create(
        {
          conversacionId: nuevaConv.id,
          deAgenteId: null,
          aAgenteId: agenteId,
          tipo: TIPO_ASIGNACION.TOMA_MANUAL,
          ejecutadoPorId: req.agente.id,
          motivo: tomar ? 'chat abierto y tomado por el agente' : 'chat abierto para contacto existente',
        },
        { transaction: t },
      );
      // Si se toma, o si el contacto no tenía dueño, el agente queda como dueño (continuidad).
      if (tomar || contacto.agenteDuenoId == null) {
        await contacto.update({ agenteDuenoId: agenteId }, { transaction: t });
      }
      return nuevaConv;
    });

    const conversacion = conv.toJSON();
    conversacion.contacto = contactoPlano(contacto);
    return res.status(201).json({ conversacion, creada: true });
  } catch (err) {
    logger.error(`abrir conversación contacto ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/** Normaliza el nombre editable: trim, máx 120, vacío → null. */
function normalizarNombre(s) {
  const t = String(s == null ? '' : s).trim().slice(0, 120);
  return t || null;
}

/** PATCH /api/contactos/:id — edita el nombre visible (nombre_display). */
async function actualizar(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const nombreDisplay = normalizarNombre(req.body && req.body.nombreDisplay);
  try {
    const contacto = await Contacto.findByPk(id);
    if (!contacto) return res.status(404).json({ error: 'no encontrado' });
    await contacto.update({ nombreDisplay });
    return res.json({
      contacto: {
        id: contacto.id,
        waId: contacto.waId,
        telefono: contacto.telefono,
        nombreWa: contacto.nombreWa,
        nombreDisplay: contacto.nombreDisplay,
      },
    });
  } catch (err) {
    logger.error(`actualizar contacto ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { crear, buscar, abrir, actualizar };
