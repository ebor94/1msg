'use strict';
const { Op } = require('sequelize');
const { Contacto, Conversacion, Asignacion, Canal, Agente } = require('../models');
const { sequelize } = require('../config/database');
const env = require('../config/env');
const { ESTADO_CONVERSACION, ORIGEN_CONVERSACION, TIPO_ASIGNACION } = require('../config/constants');
const logger = require('../utils/logger');
const { construirResultado } = require('../services/busquedaContactos');
const { consultarPlanesPorDocumento } = require('../integrations/prevision/cliente');

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
 * POST /api/contactos/:id/conversacion — abre una conversación saliente para un
 * contacto que YA existe pero aún no tiene chat activo (típico de los importados
 * con dueño asignado).
 *
 * Atómico: bloquea la fila del contacto (FOR UPDATE) y reúsa/reabre dentro de la
 * transacción, para no crear conversaciones duplicadas si dos agentes (o un
 * doble-clic) abren el mismo contacto a la vez — misma regla que `tomar()`.
 *
 * - Si ya hay una conversación NO cerrada → la devuelve tal cual.
 * - Si la última está cerrada → la reabre en sitio (mismo hilo/historial).
 * - Si no hay ninguna → crea una nueva SALIENTE/ABIERTA.
 *
 * Sin `tomar`: se asigna al dueño del contacto (`agente_dueno_id`) o, si no tiene,
 * al agente que abre (que pasa a ser su dueño). Con `tomar: true`: se asigna a
 * quien abre y se lo queda (equivale a "tomar de otro").
 */
async function abrir(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  const tomar = !!(req.body && req.body.tomar);
  try {
    const base = await Contacto.findByPk(id);
    if (!base) return res.status(404).json({ error: 'contacto no encontrado' });

    const { conv, creada } = await sequelize.transaction(async (t) => {
      // Lock del contacto: serializa aperturas concurrentes sobre el mismo lead.
      const contacto = await Contacto.findByPk(id, { lock: t.LOCK.UPDATE, transaction: t });
      const existente = await Conversacion.findOne({
        where: { contactoId: contacto.id },
        order: [['ultimoMensajeEn', 'DESC'], ['id', 'DESC']],
        transaction: t,
      });
      // Ya hay chat activo: idempotente, se devuelve para abrir.
      if (existente && existente.estado !== ESTADO_CONVERSACION.CERRADA) {
        return { conv: existente, creada: false };
      }

      const agenteAnterior = existente ? existente.agenteId : null;
      const agenteId = tomar
        ? req.agente.id
        : (agenteAnterior != null ? agenteAnterior : (contacto.agenteDuenoId || req.agente.id));

      let conv;
      if (existente) {
        // Reabrir en sitio la conversación cerrada: conserva su historial.
        await existente.update(
          { estado: ESTADO_CONVERSACION.ABIERTA, agenteId, cerradaEn: null },
          { transaction: t },
        );
        conv = existente;
      } else {
        const canalId = await resolverCanalId(t);
        conv = await Conversacion.create(
          {
            canalId,
            contactoId: contacto.id,
            agenteId,
            estado: ESTADO_CONVERSACION.ABIERTA,
            origen: ORIGEN_CONVERSACION.SALIENTE,
          },
          { transaction: t },
        );
      }
      await Asignacion.create(
        {
          conversacionId: conv.id,
          deAgenteId: agenteAnterior,
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
      return { conv, creada: !existente };
    });

    const conversacion = conv.toJSON();
    conversacion.contacto = contactoPlano(base);
    return res.status(creada ? 201 : 200).json({ conversacion, creada });
  } catch (err) {
    logger.error(`abrir conversación contacto ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * GET /api/contactos/:id/prevision — consulta los planes de previsión del cliente
 * en la BD externa `olivosct`, por su documento. Usa el `documento` del contacto;
 * si no lo tiene, acepta uno por query (`?documento=`) y lo guarda para la próxima.
 * Si no hay documento por ningún lado → { codigo: 'sin_documento' } (la UI lo pide).
 */
async function prevision(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const contacto = await Contacto.findByPk(id);
    if (!contacto) return res.status(404).json({ error: 'contacto no encontrado' });

    const provisto = req.query.documento ? soloDigitos(req.query.documento) : '';
    const guardado = contacto.documento ? soloDigitos(contacto.documento) : '';
    const doc = provisto || guardado;
    if (!doc) return res.json({ codigo: 'sin_documento' });

    // Si vino un documento por query y el contacto no tenía, lo guardamos.
    if (provisto && !guardado) {
      await contacto.update({ documento: provisto.slice(0, 20) });
    }

    const planes = await consultarPlanesPorDocumento(doc);
    return res.json({ documento: doc, planes });
  } catch (err) {
    logger.error(`prevision contacto ${id}: ${err.message}`);
    if (err.codigo === 'no_configurado') return res.status(503).json({ error: 'previsión no configurada', codigo: 'no_configurado' });
    return res.status(502).json({ error: 'no se pudo consultar la previsión' });
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

module.exports = { crear, buscar, abrir, actualizar, prevision };
