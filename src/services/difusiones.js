'use strict';
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { Difusion, DifusionDestinatario, Contacto, Agente, Canal } = require('../models');
const { parsearCsv, validarColumnas, construirDestinatarios } = require('./difusionCsv');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const env = require('../config/env');
const { renderizarCuerpo } = require('./plantillas');

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

const LIMITE_CUERPO_CARRUSEL = 160;   // límite de WhatsApp para el cuerpo de cada tarjeta
const LIMITE_CUERPO_GENERAL = 1024;   // límite para el cuerpo general del carrusel

/** Pura: solo se puede iniciar una campaña en borrador con destinatarios pendientes. */
function puedeIniciar(estado, pendientes) {
  return estado === 'borrador' && pendientes > 0;
}

/** Pura: da forma al contenido del carrusel según la plantilla (rellena huecos vacíos). */
function normalizarCarrusel(entrada, def) {
  const src = entrada || {};
  const nBody = (def.carrusel && def.carrusel.bodyVars) || 0;
  const bodyVars = Array.from({ length: nBody }, (_, i) => String((src.bodyVars || [])[i] ?? ''));
  const cards = ((def.carrusel && def.carrusel.cards) || []).map((cDef, i) => {
    const cIn = (src.cards || [])[i] || {};
    return {
      imagenUrl: cIn.imagenUrl || null,
      vars: Array.from({ length: cDef.variables || 0 }, (_, j) => String((cIn.vars || [])[j] ?? '')),
    };
  });
  return { bodyVars, cards };
}

/** Pura: valida que un carrusel esté listo para enviar (imágenes + textos completos). */
function carruselListo(dif, def) {
  if (!def || !def.esCarrusel) return { ok: true };
  const c = dif.carrusel;
  const cardsDef = (def.carrusel && def.carrusel.cards) || [];
  if (!c || !Array.isArray(c.cards) || c.cards.length !== cardsDef.length) {
    return { ok: false, motivo: 'el contenido del carrusel está incompleto' };
  }
  for (let i = 0; i < c.cards.length; i += 1) {
    const cardDef = cardsDef[i];
    const card = c.cards[i] || {};
    if (cardDef.tieneImagen && !card.imagenUrl) return { ok: false, motivo: `falta la imagen de la tarjeta ${i + 1}` };
    const llenas = (card.vars || []).filter((v) => String(v).trim()).length;
    if (llenas < (cardDef.variables || 0)) return { ok: false, motivo: `faltan textos en la tarjeta ${i + 1}` };
  }
  const bodyLlenas = (c.bodyVars || []).filter((v) => String(v).trim()).length;
  if (bodyLlenas < ((def.carrusel && def.carrusel.bodyVars) || 0)) {
    return { ok: false, motivo: 'faltan los textos del encabezado del carrusel' };
  }
  // Todas las tarjetas con imagen deben compartir la relación de aspecto (si hay dimensiones).
  // Solo valida aspecto cuando TODAS las tarjetas tienen dimensiones (WhatsApp exige
  // estructura uniforme entre tarjetas, así que en la práctica todas llevan imagen).
  const conDims = c.cards.filter((card) => card && card.ancho && card.alto);
  if (conDims.length === c.cards.length && conDims.length > 1) {
    const r0 = conDims[0].ancho / conDims[0].alto;
    const dispar = conDims.some((card) => Math.abs(card.ancho / card.alto - r0) / r0 > 0.02);
    if (dispar) return { ok: false, motivo: 'las tarjetas deben tener la misma relación de aspecto' };
  }
  // Límite de caracteres del cuerpo hidratado (WhatsApp): tarjeta ≤160, encabezado ≤1024.
  for (let i = 0; i < c.cards.length; i += 1) {
    const largo = renderizarCuerpo((cardsDef[i] && cardsDef[i].texto) || '', c.cards[i].vars || []).length;
    if (largo > LIMITE_CUERPO_CARRUSEL) {
      return { ok: false, motivo: `el texto de la tarjeta ${i + 1} supera el límite de ${LIMITE_CUERPO_CARRUSEL} caracteres (tiene ${largo})` };
    }
  }
  const largoGeneral = renderizarCuerpo(def.cuerpo || '', c.bodyVars || []).length;
  if (largoGeneral > LIMITE_CUERPO_GENERAL) {
    return { ok: false, motivo: `el texto del encabezado supera el límite de ${LIMITE_CUERPO_GENERAL} caracteres (tiene ${largoGeneral})` };
  }
  return { ok: true };
}

async function crear({ nombre, plantilla, idioma, categoria, requiereResumen, carrusel, creadoPorId }) {
  const catalogo = await obtenerCatalogo();
  const def = catalogo.find((p) => p.name === plantilla);
  if (!def) throw err(400, 'plantilla no encontrada o no aprobada');
  // El canal se resuelve por el instanceId configurado (no se hardcodea).
  const canal = await Canal.findOne({ where: { instanceId: env.onemsg.instanceId } });
  if (!canal) throw err(503, 'canal WABA no configurado');
  return Difusion.create({
    nombre, plantillaNombre: plantilla, plantillaIdioma: idioma || def.language || 'es',
    categoria: String(categoria || def.categoria || 'utility').toLowerCase(), estado: 'borrador',
    canalId: canal.id, creadoPorId, requiereResumen: !!requiereResumen,
    carrusel: def.esCarrusel ? normalizarCarrusel(carrusel, def) : null,
  });
}

/** Resuelve/crea contactos e inserta destinatarios. Devuelve el resumen de validación. */
async function cargarDestinatarios(difusionId, { texto, mapeo }) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const { cabeceras, filas } = parsearCsv(texto);
  validarColumnas(cabeceras, mapeo); // lanza 400 si faltan columnas
  if (dif.requiereResumen && !cabeceras.includes(mapeo.cedula || 'CEDULA')) {
    throw err(400, 'esta difusión requiere resumen: el CSV debe traer la columna CEDULA');
  }
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
    if (!contacto) {
      contacto = await Contacto.create({ waId: d.waId, telefono: d.telefono, nombreDisplay: d.nombre || null });
    } else if (d.nombre && !contacto.nombreDisplay) {
      // Rellenar el nombre si el contacto existente no tiene uno (sin pisar uno real).
      await contacto.update({ nombreDisplay: d.nombre });
    }
    // Upsert del destinatario (clave única difusion_id+contacto_id → no duplica).
    await DifusionDestinatario.findOrCreate({
      where: { difusionId, contactoId: contacto.id },
      defaults: { difusionId, contactoId: contacto.id, agenteId: d.agenteId, parametros: d.parametros, documento: d.documento || null, estado: 'pendiente' },
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
  if (dif.carrusel) {
    const def = (await obtenerCatalogo()).find((p) => p.name === dif.plantillaNombre);
    if (!def) throw err(400, 'plantilla no encontrada o no aprobada');
    const chk = carruselListo(dif, def);
    if (!chk.ok) throw err(400, chk.motivo);
  }
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

module.exports = {
  puedeIniciar, normalizarCarrusel, carruselListo,
  crear, cargarDestinatarios, iniciar, cancelar, listar, detalle, destinatarios,
};
