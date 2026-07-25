'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto, Agente, Asignacion, NotaInterna } = require('../models');
const { listar, puedeVer } = require('../services/conversaciones');
const { enviarTexto } = require('../integrations/onemsg/envio');
const { enviarPlantilla: enviarPlantillaOnemsg } = require('../integrations/onemsg/plantillas');
const { enviarArchivo } = require('../integrations/onemsg/media');
const { ventanaAbierta, conFirma } = require('../services/envio');
const { guardarBufferComoMedia, categoriaMedia } = require('../services/media');
const { registrar } = require('../services/mediaPublica');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('../services/plantillas');
const { obtenerCatalogo } = require('./plantillasController');
const { tipoDeAsignacion, roomsDeAsignacion } = require('../services/asignacionManual');
const { emitir, emitirARooms } = require('../sockets/emisor');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION, TIPO_ASIGNACION } = require('../config/constants');
const env = require('../config/env');
const logger = require('../utils/logger');

const ETIQUETA_MEDIA = { image: '📷 Imagen', audio: '🎤 Audio', video: '🎬 Video', document: '📄 Documento' };

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
    const status = err.status || 500;
    return res.status(status).json({ error: status === 403 ? err.message : 'error interno' });
  }
}

async function mensajes(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const where = { conversacionId: conv.id };
    if (req.query.antesDe !== undefined) {
      const antesDe = Number(req.query.antesDe);
      if (!Number.isInteger(antesDe)) return res.status(400).json({ error: 'antesDe inválido' });
      where.id = { [Op.lt]: antesDe };
    }
    const filas = await Mensaje.findAll({ where, order: [['tsProveedor', 'DESC'], ['id', 'DESC']], limit: 30 });
    return res.json({ mensajes: filas.reverse() });
  } catch (err) {
    logger.error(`mensajes conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function leer(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await Conversacion.update({ noLeidos: 0 }, { where: { id: conv.id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`leer conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function enviar(req, res) {
  const texto = (req.body && req.body.texto ? String(req.body.texto) : '').trim();
  if (!texto) return res.status(400).json({ error: 'texto vacío' });

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });

    // Re-validar el agente (primer endpoint de escritura) y obtener su firma.
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'fuera de la ventana de 24h', codigo: 'fuera_de_ventana' });
    }

    const textoFinal = conFirma(agente.firma, texto);
    let enviado;
    try {
      enviado = await enviarTexto({ chatId: conv.contacto.waId, texto: textoFinal });
    } catch (err) {
      logger.error(`envío 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar', codigo: err.codigo || null });
    }

    const ahora = new Date();
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id,
        waMessageId: enviado.id,
        direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEXT,
        texto: textoFinal,
        estado: enviado.sent ? ESTADO_MENSAJE.ENVIADO : ESTADO_MENSAJE.PENDIENTE,
        enviadoPorId: agente.id,
        tsProveedor: ahora,
      },
    });
    await conv.update({
      ultimoMensajeEn: ahora,
      ultimoMensajeTexto: textoFinal.slice(0, 255),
      ultimoMensajeDir: DIRECCION.OUT,
    });

    const destino = { agenteId: conv.agenteId, general: !conv.agenteId };
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje });

    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function enviarMedia(req, res) {
  const archivo = req.file;
  if (!archivo) return res.status(400).json({ error: 'archivo requerido' });
  const caption = (req.body && req.body.caption ? String(req.body.caption) : '').trim();

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });
    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'la ventana de 24h está cerrada', codigo: 'fuera_de_ventana' });
    }
    if (!/^https?:\/\//.test(env.publicBaseUrl)) {
      logger.error('enviarMedia: PUBLIC_BASE_URL no configurada (Meta no podría descargar el adjunto)');
      return res.status(500).json({ error: 'envío de adjuntos no configurado' });
    }

    const categoria = categoriaMedia(archivo.mimetype);
    const token = crypto.randomBytes(32).toString('hex');
    const guardado = await guardarBufferComoMedia({
      buffer: archivo.buffer,
      contentType: archivo.mimetype,
      conversacionId: conv.id,
      nombreArchivo: `out-${token}`,
      nombreOriginal: archivo.originalname,
      fecha: new Date(),
    });
    const tokenPublico = registrar(guardado.mediaRuta, guardado.mediaMime);
    const urlPublica = `${env.publicBaseUrl}/media-publico/${tokenPublico}`;
    const captionFinal = caption ? conFirma(agente.firma, caption) : '';

    let enviado;
    try {
      enviado = await enviarArchivo({
        chatId: conv.contacto.waId,
        url: urlPublica,
        mediaType: categoria,
        caption: captionFinal,
        filename: guardado.mediaNombre || undefined,
      });
    } catch (err) {
      logger.error(`envío media 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar el archivo', codigo: err.codigo || null });
    }

    const ahora = new Date();
    const desnorm = captionFinal || ETIQUETA_MEDIA[categoria] || '📎 Archivo';
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id, waMessageId: enviado.id, direccion: DIRECCION.OUT,
        tipo: categoria, texto: captionFinal || null,
        mediaRuta: guardado.mediaRuta, mediaMime: guardado.mediaMime,
        mediaNombre: guardado.mediaNombre, mediaBytes: guardado.mediaBytes,
        estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: agente.id, tsProveedor: ahora,
      },
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: String(desnorm).slice(0, 255), ultimoMensajeDir: DIRECCION.OUT });
    emitir('mensaje:nuevo', { agenteId: conv.agenteId, general: !conv.agenteId }, { conversacionId: conv.id, mensaje });
    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviarMedia conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * Envío de plantilla aprobada. A diferencia de `enviar`, NO valida la
 * ventana de 24h: ese es justamente el caso de uso de las plantillas.
 */
async function enviarPlantilla(req, res) {
  const { template, language, variables, imagenUrl, namespace } = req.body || {};
  if (!template) return res.status(400).json({ error: 'plantilla requerida' });
  const vars = Array.isArray(variables) ? variables : [];

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'telefono'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    let enviado;
    try {
      const params = [...construirParamsHeader(imagenUrl), ...construirParams(vars)];
      enviado = await enviarPlantillaOnemsg({
        phone: conv.contacto.telefono,
        template,
        namespace: namespace || null,
        language: { code: language || 'es', policy: 'deterministic' },
        params,
      });
    } catch (err) {
      logger.error(`envío plantilla 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar la plantilla', codigo: err.codigo || null });
    }

    let textoMostrar = `[plantilla: ${template}]`;
    try {
      const catalogo = await obtenerCatalogo();
      const def = catalogo.find((p) => p.name === template);
      textoMostrar = def ? renderizarCuerpo(def.cuerpo, vars) : `[plantilla: ${template}]`;
    } catch (err) {
      logger.warn(`catálogo de plantillas no disponible, uso placeholder (conv ${conv.id}): ${err.message}`);
    }
    const ahora = new Date();
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id,
        waMessageId: enviado.id,
        direccion: DIRECCION.OUT,
        tipo: TIPO_MENSAJE.TEMPLATE,
        texto: textoMostrar,
        plantillaNombre: template,
        estado: enviado.sent ? ESTADO_MENSAJE.ENVIADO : ESTADO_MENSAJE.PENDIENTE,
        enviadoPorId: agente.id,
        tsProveedor: ahora,
      },
    });
    await conv.update({
      ultimoMensajeEn: ahora,
      ultimoMensajeTexto: textoMostrar.slice(0, 255),
      ultimoMensajeDir: DIRECCION.OUT,
    });

    const destino = { agenteId: conv.agenteId, general: !conv.agenteId };
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje });

    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviarPlantilla conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * Toma atómica de un chat de la bandeja general. La guarda va en el WHERE
 * del UPDATE (agenteId: null): si affectedRows = 0, otro agente se adelantó
 * y devolvemos 409. Nunca SELECT + UPDATE (condición de carrera).
 */
async function tomar(req, res) {
  const id = req.params.id;
  const me = req.agente.id;
  try {
    const conv = await Conversacion.findByPk(id);
    if (!conv) return res.status(404).json({ error: 'no encontrada' });

    const resultado = await sequelize.transaction(async (t) => {
      const [n] = await Conversacion.update(
        { agenteId: me, tomadaEn: new Date(), estado: ESTADO_CONVERSACION.ABIERTA },
        { where: { id, agenteId: null }, transaction: t },
      );
      if (n === 0) return null; // otro se adelantó
      await Contacto.update({ agenteDuenoId: me }, { where: { id: conv.contactoId }, transaction: t });
      await Asignacion.create(
        { conversacionId: id, deAgenteId: null, aAgenteId: me, tipo: TIPO_ASIGNACION.TOMA_MANUAL, ejecutadoPorId: me },
        { transaction: t },
      );
      return true;
    });
    if (!resultado) return res.status(409).json({ error: 'otro agente ya la tomó', codigo: 'tomada' });

    emitirARooms('conversacion:asignada', roomsDeAsignacion(null, me), { conversacionId: Number(id), agenteId: me });
    const actualizada = await Conversacion.findByPk(id);
    return res.json({ conversacion: actualizada });
  } catch (err) {
    logger.error(`tomar conversación ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * Reasignación manual: a otro agente o de vuelta a la bandeja general
 * (agenteId: null). Transfiere también la dueñez del contacto para que la
 * continuidad (regla 1 de asignación) le devuelva los próximos mensajes.
 */
async function asignar(req, res) {
  const id = req.params.id;
  const me = req.agente.id;
  const nuevo = req.body && req.body.agenteId != null ? Number(req.body.agenteId) : null;
  if (req.body && req.body.agenteId != null && !Number.isInteger(nuevo)) {
    return res.status(400).json({ error: 'agenteId inválido' });
  }
  try {
    const conv = await Conversacion.findByPk(id);
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (nuevo) {
      const ag = await Agente.findByPk(nuevo);
      if (!ag || !ag.activo) return res.status(400).json({ error: 'agente destino inválido' });
    }
    let anterior = null;
    await sequelize.transaction(async (t) => {
      // Leer el dueño anterior DENTRO de la transacción (con lock) para que el
      // audit y el evento reflejen el estado real aunque haya una toma concurrente.
      const actual = await Conversacion.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      anterior = actual.agenteId;
      await Conversacion.update(
        { agenteId: nuevo, estado: nuevo ? ESTADO_CONVERSACION.ABIERTA : ESTADO_CONVERSACION.NUEVA },
        { where: { id }, transaction: t },
      );
      await Contacto.update({ agenteDuenoId: nuevo }, { where: { id: actual.contactoId }, transaction: t });
      await Asignacion.create(
        { conversacionId: id, deAgenteId: anterior, aAgenteId: nuevo, tipo: tipoDeAsignacion(anterior, nuevo), ejecutadoPorId: me },
        { transaction: t },
      );
    });

    emitirARooms('conversacion:asignada', roomsDeAsignacion(anterior, nuevo), { conversacionId: Number(id), agenteId: nuevo });
    const actualizada = await Conversacion.findByPk(id);
    return res.json({ conversacion: actualizada });
  } catch (err) {
    logger.error(`asignar conversación ${id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function agregarNota(req, res) {
  const nota = (req.body && req.body.nota ? String(req.body.nota) : '').trim();
  if (!nota) return res.status(400).json({ error: 'nota vacía' });
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const creada = await NotaInterna.create({ conversacionId: conv.id, agenteId: req.agente.id, nota });
    return res.status(201).json({ nota: { id: creada.id, nota: creada.nota, agente: req.agente.nombre, creadoEn: creada.creado_en } });
  } catch (err) {
    logger.error(`nota conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function listarNotas(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const filas = await NotaInterna.findAll({
      where: { conversacionId: conv.id },
      order: [['id', 'ASC']],
      include: [{ model: Agente, as: 'agente', attributes: ['nombre'] }],
    });
    const notas = filas.map((n) => ({ id: n.id, nota: n.nota, agente: n.agente ? n.agente.nombre : null, creadoEn: n.creado_en }));
    return res.json({ notas });
  } catch (err) {
    logger.error(`listar notas ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listarHandler, mensajes, leer, enviar, enviarMedia, enviarPlantilla, tomar, asignar, agregarNota, listarNotas };
