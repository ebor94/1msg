'use strict';
const { Recordatorio, Ajuste, Contacto, Canal } = require('../models');
const { enviarPlantilla } = require('../integrations/onemsg/plantillas');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('./plantillas');
const { obtenerCatalogo } = require('../controllers/plantillasController');
const { persistirEnvioPlantilla } = require('./envioPlantilla');
const { esDiaDeEnvio, diasDelMes } = require('./recordatorioReglas');
const { ORIGEN_CONVERSACION } = require('../config/constants');
const env = require('../config/env');
const logger = require('../utils/logger');

const CLAVES = ['recordatorio_plantilla', 'recordatorio_texto', 'recordatorio_imagen_url'];

function err(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function obtenerAjustes() {
  const filas = await Ajuste.findAll({ where: { clave: CLAVES } });
  const m = {};
  filas.forEach((f) => { m[f.clave] = f.valor; });
  return m;
}

/** Pura: hay contenido para enviar (texto y URL no vacíos). */
function recordatorioConfigurado(aj) {
  return !!(aj && String(aj.recordatorio_texto || '').trim() && String(aj.recordatorio_imagen_url || '').trim());
}

async function recordatorioDeContacto(contactoId) {
  const r = await Recordatorio.findOne({ where: { contactoId } });
  return r ? { activo: !!r.activo, diaMes: r.diaMes } : null;
}

async function guardarRecordatorio(contactoId, { activo, diaMes }, agente) {
  const dia = Number(diaMes);
  if (activo && (!Number.isInteger(dia) || dia < 1 || dia > 30)) throw err(400, 'día inválido (1-30)');
  const [r] = await Recordatorio.findOrCreate({
    where: { contactoId },
    defaults: { contactoId, diaMes: Number.isInteger(dia) ? dia : 1, activo: !!activo, agenteId: agente ? agente.id : null, creadoPorId: agente ? agente.id : null },
  });
  await r.update({ activo: !!activo, diaMes: Number.isInteger(dia) ? dia : r.diaMes, agenteId: r.agenteId || (agente ? agente.id : null) });
  return { activo: !!r.activo, diaMes: r.diaMes };
}

/** El próximo recordatorio enviable hoy (activo, toca hoy, no enviado este mes). */
async function siguienteRecordatorio(hoyISO) {
  const anio = +hoyISO.slice(0, 4), mes = +hoyISO.slice(5, 7), dia = +hoyISO.slice(8, 10);
  const dim = diasDelMes(anio, mes);
  const inicioMes = `${hoyISO.slice(0, 7)}-01`;
  // Solo recordatorios activos de contactos NO desactivados (a un contacto desactivado
  // no se le escribe, igual que en los envíos normales). INNER JOIN vía include.
  const activos = await Recordatorio.findAll({
    where: { activo: true },
    include: [{ model: Contacto, as: 'contacto', where: { desactivadoEn: null }, required: true, attributes: [] }],
    order: [['id', 'ASC']],
  });
  return activos.find((r) => esDiaDeEnvio(r.diaMes, dia, dim) && (!r.ultimoEnvioEn || String(r.ultimoEnvioEn) < inicioMes)) || null;
}

/** Envía un recordatorio y lo persiste; marca ultimo_envio_en = hoy en la misma transacción. */
async function enviarRecordatorio(rec, aj, hoyISO, deps = {}) {
  const enviar = deps.enviarPlantilla || enviarPlantilla;
  const def = (await obtenerCatalogo()).find((p) => p.name === aj.recordatorio_plantilla);
  if (!def) { logger.error(`recordatorio: plantilla ${aj.recordatorio_plantilla} no está en el catálogo`); return 'sin_plantilla'; }
  const contacto = await Contacto.findByPk(rec.contactoId);
  if (!contacto) { try { await rec.update({ ultimoEnvioEn: hoyISO }); } catch { /* ignore */ } return 'sin_contacto'; }
  const canal = await Canal.findOne({ where: { instanceId: env.onemsg.instanceId } });
  if (!canal) { logger.error('recordatorio: canal WABA no configurado'); return 'sin_canal'; }

  const params = [
    ...construirParamsHeader(aj.recordatorio_imagen_url || def.imagenDefault),
    ...construirParams([aj.recordatorio_texto]),
  ];
  let enviado;
  try {
    enviado = await enviar({
      phone: contacto.telefono, template: def.name,
      language: { code: def.language || 'es', policy: 'deterministic' },
      namespace: def.namespace || null, params,
    });
  } catch (err2) {
    logger.warn(`recordatorio contacto ${rec.contactoId}: fallo [${err2.codigo || ''}] ${err2.message}`);
    // marca el recordatorio como procesado este mes para no reintentar un envío que ya
    // falló de forma persistente (enviarPlantilla ya reintentó los 429) ni bloquear a los demás
    try { await rec.update({ ultimoEnvioEn: hoyISO }); } catch { /* si falla el marcado, se reintentará; no bloquea */ }
    return 'fallido';
  }

  const texto = renderizarCuerpo(def.cuerpo, [aj.recordatorio_texto]);
  await persistirEnvioPlantilla({
    contactoId: rec.contactoId, agenteFallback: rec.agenteId, canalId: canal.id,
    plantillaNombre: def.name, texto, waMessageId: enviado.id, origen: ORIGEN_CONVERSACION.RECORDATORIO,
  }, async (t) => { await rec.update({ ultimoEnvioEn: hoyISO }, { transaction: t }); });
  return 'enviado';
}

module.exports = { obtenerAjustes, recordatorioConfigurado, recordatorioDeContacto, guardarRecordatorio, siguienteRecordatorio, enviarRecordatorio };
