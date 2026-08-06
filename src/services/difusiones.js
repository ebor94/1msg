'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { Difusion, DifusionDestinatario, Contacto, Agente, Canal } = require('../models');
const { parsearCsv, validarColumnas, construirDestinatarios } = require('./difusionCsv');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const env = require('../config/env');

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

/** Pura: solo se puede iniciar una campaña en borrador con destinatarios pendientes. */
function puedeIniciar(estado, pendientes) {
  return estado === 'borrador' && pendientes > 0;
}

async function crear({ nombre, plantilla, idioma, categoria, creadoPorId }) {
  const catalogo = await obtenerCatalogo();
  const def = catalogo.find((p) => p.name === plantilla);
  if (!def) throw err(400, 'plantilla no encontrada o no aprobada');
  // El canal se resuelve por el instanceId configurado (no se hardcodea).
  const canal = await Canal.findOne({ where: { instanceId: env.onemsg.instanceId } });
  if (!canal) throw err(503, 'canal WABA no configurado');
  return Difusion.create({
    nombre, plantillaNombre: plantilla, plantillaIdioma: idioma || def.language || 'es',
    categoria: String(categoria || def.categoria || 'utility').toLowerCase(), estado: 'borrador',
    canalId: canal.id, creadoPorId,
  });
}

/** Resuelve/crea contactos e inserta destinatarios. Devuelve el resumen de validación. */
async function cargarDestinatarios(difusionId, { texto, mapeo }) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const { cabeceras, filas } = parsearCsv(texto);
  validarColumnas(cabeceras, mapeo); // lanza 400 si faltan columnas
  const agentes = await Agente.findAll({ where: { activo: true }, attributes: ['id'] });
  const destinatarios = construirDestinatarios({ filas, mapeo, agentesActivos: agentes.map((a) => a.id) });

  const omitidos = [];
  for (const d of destinatarios) {
    if (d.estado === 'omitido') { omitidos.push({ telefono: d.telefono, motivo: d.motivo }); continue; }
    // Reusar el contacto existente por TELÉFONO (identidad canónica del cliente).
    // El wa_id del sistema es '<telefono>@c.us' y no siempre coincide con lo que
    // trae el CSV, así que buscar por wa_id crearía un duplicado. Si no existe, se
    // crea con el wa_id canónico.
    let contacto = await Contacto.findOne({ where: { telefono: d.telefono }, order: [['id', 'ASC']] });
    if (!contacto) contacto = await Contacto.create({ waId: d.waId, telefono: d.telefono });
    // Upsert del destinatario (clave única difusion_id+contacto_id → no duplica).
    await DifusionDestinatario.findOrCreate({
      where: { difusionId, contactoId: contacto.id },
      defaults: { difusionId, contactoId: contacto.id, agenteId: d.agenteId, parametros: d.parametros, estado: 'pendiente' },
    });
  }
  // Cuenta real de pendientes (no el contador local, que ignoraría reintentos
  // de findOrCreate sobre filas ya existentes en estado enviado/fallido).
  const pendientes = await DifusionDestinatario.count({ where: { difusionId, estado: 'pendiente' } });
  return { total: destinatarios.length, pendientes, omitidos };
}

async function iniciar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const pendientes = await DifusionDestinatario.count({ where: { difusionId, estado: 'pendiente' } });
  if (!puedeIniciar(dif.estado, pendientes)) throw err(409, 'la campaña no se puede iniciar (revisa estado y destinatarios)');
  await dif.update({ estado: 'enviando' });
}

async function cancelar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  await dif.update({ estado: 'cancelada' });
}

async function listar() {
  return sequelize.query(
    `SELECT d.id, d.nombre, d.plantilla_nombre AS plantilla, d.estado, d.creado_en AS creadoEn,
            COUNT(dd.id) AS total,
            COALESCE(SUM(dd.estado IN ('enviado','entregado','leido')), 0) AS enviados
       FROM wa_difusiones d
       LEFT JOIN wa_difusion_destinatarios dd ON dd.difusion_id = d.id
      GROUP BY d.id
      ORDER BY d.creado_en DESC`,
    { type: QueryTypes.SELECT },
  );
}

/** Embudo por campaña: estados del destinatario + entrega real (join con wa_mensajes). */
async function detalle(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const [embudo] = await sequelize.query(
    `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(dd.estado = 'omitido'), 0) AS omitidos,
        COALESCE(SUM(dd.estado IN ('enviado','entregado','leido')), 0) AS enviados,
        COALESCE(SUM(m.estado IN ('entregado','leido')), 0) AS entregados,
        COALESCE(SUM(m.estado = 'leido'), 0) AS leidos,
        COALESCE(SUM(dd.estado = 'fallido'), 0) AS fallidos
       FROM wa_difusion_destinatarios dd
       LEFT JOIN wa_mensajes m ON m.wa_message_id = dd.wa_message_id
      WHERE dd.difusion_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } },
  );
  const [{ fallidosPorCodigo }] = [{ fallidosPorCodigo: await sequelize.query(
    `SELECT error_codigo AS codigo, COUNT(*) AS n FROM wa_difusion_destinatarios
      WHERE difusion_id = :id AND estado = 'fallido' AND error_codigo IS NOT NULL GROUP BY error_codigo`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } }) }];
  const [{ respondidos }] = await sequelize.query(
    `SELECT COUNT(DISTINCT dd.contacto_id) AS respondidos
       FROM wa_difusion_destinatarios dd
       JOIN wa_mensajes env ON env.wa_message_id = dd.wa_message_id
       JOIN wa_conversaciones c ON c.id = env.conversacion_id
       JOIN wa_mensajes r ON r.conversacion_id = c.id AND r.direccion = 'in' AND r.ts_proveedor > env.ts_proveedor
      WHERE dd.difusion_id = :id`,
    { type: QueryTypes.SELECT, replacements: { id: difusionId } },
  );
  return { difusion: dif, embudo: { ...embudo, respondidos, fallidosPorCodigo } };
}

async function destinatarios(difusionId, { estado, pagina = 0, tam = 50 } = {}) {
  const where = { difusionId, ...(estado ? { estado } : {}) };
  const { count, rows } = await DifusionDestinatario.findAndCountAll({
    where, limit: tam, offset: pagina * tam, order: [['id', 'ASC']],
  });
  return { total: count, filas: rows };
}

module.exports = { puedeIniciar, crear, cargarDestinatarios, iniciar, cancelar, listar, detalle, destinatarios };
