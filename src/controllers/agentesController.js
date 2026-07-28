'use strict';
const { QueryTypes } = require('sequelize');
const { Agente } = require('../models');
const { sequelize } = require('../config/database');
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

/**
 * GET /api/agentes/totales — resumen por agente para administradores.
 * Por cada agente: contactos de los que es dueño (cartera), conversaciones
 * activas (Míos), no leídas y resueltas. Dos GROUP BY + la lista de agentes.
 */
async function totales(req, res) {
  try {
    const [contactos, convs, agentes] = await Promise.all([
      sequelize.query(
        'SELECT agente_dueno_id AS id, COUNT(*) AS n FROM wa_contactos WHERE agente_dueno_id IS NOT NULL GROUP BY agente_dueno_id',
        { type: QueryTypes.SELECT },
      ),
      sequelize.query(
        `SELECT agente_id AS id,
                SUM(estado IN ('nueva','abierta','pendiente')) AS activas,
                SUM(estado = 'cerrada') AS resueltas,
                SUM(estado IN ('nueva','abierta','pendiente') AND no_leidos > 0) AS no_leidas
           FROM wa_conversaciones
          WHERE agente_id IS NOT NULL
          GROUP BY agente_id`,
        { type: QueryTypes.SELECT },
      ),
      Agente.findAll({ attributes: ['id', 'nombre', 'rol', 'activo'], order: [['nombre', 'ASC']] }),
    ]);
    const mapContactos = new Map(contactos.map((r) => [r.id, Number(r.n)]));
    const mapConvs = new Map(convs.map((r) => [r.id, r]));
    const filas = agentes.map((a) => {
      const v = mapConvs.get(a.id) || {};
      return {
        id: a.id,
        nombre: a.nombre,
        rol: a.rol,
        activo: !!a.activo,
        contactos: mapContactos.get(a.id) || 0,
        activas: Number(v.activas || 0),
        noLeidas: Number(v.no_leidas || 0),
        resueltas: Number(v.resueltas || 0),
      };
    });
    return res.json({ agentes: filas });
  } catch (err) {
    logger.error(`totales por agente: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listar, totales };
