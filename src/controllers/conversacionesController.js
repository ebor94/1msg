'use strict';
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Conversacion, Mensaje, Contacto, Agente, Asignacion, NotaInterna } = require('../models');
const { listar, puedeVer, contarBandejas } = require('../services/conversaciones');
const { recuperarHistorial } = require('../services/backfill');
const { enviarTexto } = require('../integrations/onemsg/envio');
const { enviarPlantilla: enviarPlantillaOnemsg } = require('../integrations/onemsg/plantillas');
const { enviarArchivo } = require('../integrations/onemsg/media');
const { ventanaAbierta, destinatario1msg, contactoActivo } = require('../services/envio');
const { guardarBufferComoMedia, categoriaMedia } = require('../services/media');
const { transcodificarAOgg } = require('../services/audio');
const { registrar } = require('../services/mediaPublica');
const { construirParams, construirParamsHeader, renderizarCuerpo } = require('../services/plantillas');
const { obtenerCatalogo } = require('./plantillasController');
const { tipoDeAsignacion, roomsDeAsignacion } = require('../services/asignacionManual');
const { emitir, emitirARooms } = require('../sockets/emisor');
const etiquetasSvc = require('../services/etiquetas');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE, ESTADO_CONVERSACION, TIPO_ASIGNACION, ROL_AGENTE } = require('../config/constants');
const env = require('../config/env');
const logger = require('../utils/logger');

const ETIQUETA_MEDIA = { image: '📷 Imagen', audio: '🎤 Audio', video: '🎬 Video', document: '📄 Documento' };

async function accesible(req, res) {
  const conv = await Conversacion.findByPk(req.params.id);
  if (!conv) { res.status(404).json({ error: 'no encontrada' }); return null; }
  if (!puedeVer(req.agente, conv)) { res.status(403).json({ error: 'sin acceso' }); return null; }
  return conv;
}

/** GET /api/conversaciones/contadores — cantidad de chats por bandeja (badges). */
async function contadores(req, res) {
  try {
    const c = await contarBandejas({
      agenteSolicitante: req.agente,
      agenteFiltro: req.query.agente ? Number(req.query.agente) : null,
    });
    return res.json(c);
  } catch (err) {
    logger.error(`contadores bandeja: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function listarHandler(req, res) {
  try {
    const ocultos = req.query.ocultos === '1' || req.query.ocultos === 'true';
    const r = await listar({
      bandeja: req.query.bandeja,
      agenteSolicitante: req.agente,
      agenteFiltro: req.query.agente ? Number(req.query.agente) : null,
      q: req.query.q || null,
      soloNoLeidos: req.query.noLeidos === '1',
      ocultos,
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
    const { antesDeTs, antesDeId } = req.query;
    if (antesDeTs !== undefined && antesDeId !== undefined) {
      const ts = new Date(antesDeTs);
      const id = Number(antesDeId);
      if (Number.isNaN(ts.getTime()) || !Number.isInteger(id)) {
        return res.status(400).json({ error: 'cursor inválido' });
      }
      where[Op.or] = [
        { tsProveedor: { [Op.lt]: ts } },
        { tsProveedor: ts, id: { [Op.lt]: id } },
      ];
    }
    const filas = await Mensaje.findAll({
      where,
      order: [['tsProveedor', 'DESC'], ['id', 'DESC']],
      limit: 30,
      include: [{ model: Agente, as: 'enviadoPor', attributes: ['id', 'nombre'] }],
    });
    return res.json({ mensajes: filas.reverse() });
  } catch (err) {
    logger.error(`mensajes conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function historial(req, res) {
  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'bsuid'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    if (!conv.contacto) return res.status(404).json({ error: 'sin contacto' });

    const r = await recuperarHistorial(conv);
    return res.json(r);
  } catch (err) {
    if (err.name === 'OneMsgError') {
      logger.error(`historial 1msg (conv ${req.params.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo recuperar el historial', codigo: err.codigo || null });
    }
    logger.error(`historial conversación ${req.params.id}: ${err.message}`);
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

async function resolver(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    // Un chat sin dueño (general) no se puede resolver: se caería de la cola sin
    // quedar en la bandeja de resueltos de nadie. Hay que tomarlo primero.
    if (conv.agenteId == null) {
      return res.status(409).json({ error: 'toma el chat antes de resolverlo', codigo: 'sin_asignar' });
    }
    await Conversacion.update(
      { estado: ESTADO_CONVERSACION.CERRADA, cerradaEn: new Date() },
      { where: { id: conv.id } },
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`resolver conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function noLeido(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await Conversacion.update(
      { noLeidos: sequelize.literal('GREATEST(no_leidos, 1)') },
      { where: { id: conv.id } },
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`marcar no leído ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

/**
 * "Responder = tomar". Antes de enviar, si el chat está en general lo toma para
 * el agente de forma ATÓMICA. Así, si dos agentes responden el mismo chat a la
 * vez, solo uno gana la propiedad y el otro recibe conflicto (su envío se aborta),
 * evitando la respuesta doble. Si ya es suyo, no hace nada. Un administrador puede
 * responder un chat de otro sin quitárselo (supervisión).
 *
 * Devuelve { ok, tomada } — ok:false => conflicto (otro agente lo tomó primero).
 * Muta conv.agenteId en memoria cuando lo toma, para que el emisor apunte bien.
 */
async function tomarParaEnvio(conv, reqAgente) {
  const me = reqAgente.id;
  if (conv.agenteId === me) return { ok: true, tomada: false };
  if (conv.agenteId != null) {
    // De otro agente: solo un admin puede responder sin tomarlo.
    if (reqAgente.rol === ROL_AGENTE.ADMINISTRADOR) return { ok: true, tomada: false };
    return { ok: false, tomada: false };
  }
  // General: toma atómica (mismo patrón que `tomar`).
  const estadoAnterior = conv.estado;
  const res = await sequelize.transaction(async (t) => {
    const [n] = await Conversacion.update(
      { agenteId: me, tomadaEn: new Date(), estado: ESTADO_CONVERSACION.ABIERTA },
      { where: { id: conv.id, agenteId: null }, transaction: t },
    );
    if (n === 0) return null;
    const [dn] = await Contacto.update(
      { agenteDuenoId: me },
      { where: { id: conv.contactoId, agenteDuenoId: null }, transaction: t },
    );
    await Asignacion.create(
      { conversacionId: conv.id, deAgenteId: null, aAgenteId: me, tipo: TIPO_ASIGNACION.TOMA_MANUAL, ejecutadoPorId: me, motivo: 'auto-toma al responder' },
      { transaction: t },
    );
    return { puseDueno: dn === 1 };
  });
  if (res) { conv.agenteId = me; return { ok: true, tomada: true, puseDueno: res.puseDueno, estadoAnterior }; }
  // Perdió la carrera: ¿quién quedó de dueño?
  const fresca = await Conversacion.findByPk(conv.id, { attributes: ['id', 'agenteId'] });
  if (fresca && fresca.agenteId === me) { conv.agenteId = me; return { ok: true, tomada: false }; }
  return { ok: false, tomada: false };
}

/**
 * Compensación: si el envío a 1msg falla DESPUÉS de una auto-toma, devuelve el
 * chat a general para que no quede asignado sin respuesta (y no desaparezca de la
 * bandeja general sin que nadie lo note). Best-effort.
 */
async function liberarToma(conv, agenteId, toma) {
  try {
    await sequelize.transaction(async (t) => {
      await Conversacion.update(
        { agenteId: null, tomadaEn: null, estado: toma.estadoAnterior || ESTADO_CONVERSACION.NUEVA },
        { where: { id: conv.id, agenteId }, transaction: t },
      );
      if (toma.puseDueno) {
        await Contacto.update(
          { agenteDuenoId: null },
          { where: { id: conv.contactoId, agenteDuenoId: agenteId }, transaction: t },
        );
      }
      await Asignacion.create(
        { conversacionId: conv.id, deAgenteId: agenteId, aAgenteId: null, tipo: TIPO_ASIGNACION.TOMA_MANUAL, ejecutadoPorId: agenteId, motivo: 'devuelta a general: el envío falló' },
        { transaction: t },
      );
    });
    conv.agenteId = null;
    emitirARooms('conversacion:asignada', roomsDeAsignacion(agenteId, null), { conversacionId: conv.id, agenteId: null });
  } catch (e) {
    logger.error(`liberarToma conv ${conv.id}: ${e.message}`);
  }
}

/** Avisa a las salas que un chat de general pasó a ser de un agente. */
function emitirAutoToma(convId, agenteId) {
  emitirARooms('conversacion:asignada', roomsDeAsignacion(null, agenteId), { conversacionId: convId, agenteId });
}

async function enviar(req, res) {
  const texto = (req.body && req.body.texto ? String(req.body.texto) : '').trim();
  if (!texto) return res.status(400).json({ error: 'texto vacío' });

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'bsuid', 'desactivadoEn'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });

    if (!contactoActivo(conv.contacto)) {
      return res.status(409).json({ error: 'el contacto está desactivado', codigo: 'contacto_desactivado' });
    }

    // Re-validar el agente (primer endpoint de escritura) y obtener su firma.
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'fuera de la ventana de 24h', codigo: 'fuera_de_ventana' });
    }

    // Responder = tomar (atómico). Si otro agente se adelantó, se aborta el envío.
    const toma = await tomarParaEnvio(conv, req.agente);
    if (!toma.ok) return res.status(409).json({ error: 'otro agente ya tomó este chat', codigo: 'tomada' });

    // Sin prefijo de firma: confundía a los clientes (leían "Nombre |" como si
    // los llamaran así). El autor se sabe internamente por enviado_por_id.
    const textoFinal = texto;
    let enviado;
    try {
      enviado = await enviarTexto({ ...destinatario1msg(conv.contacto), texto: textoFinal });
    } catch (err) {
      logger.error(`envío 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      if (toma.tomada) await liberarToma(conv, req.agente.id, toma);
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

    if (toma.tomada) emitirAutoToma(conv.id, req.agente.id);
    const salida = { ...mensaje.toJSON(), enviadoPor: { id: agente.id, nombre: agente.nombre } };
    const destino = { agenteId: conv.agenteId, general: !conv.agenteId };
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje: salida });

    return res.status(201).json({ mensaje: salida });
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
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'bsuid', 'desactivadoEn'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    if (!contactoActivo(conv.contacto)) {
      return res.status(409).json({ error: 'el contacto está desactivado', codigo: 'contacto_desactivado' });
    }
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });
    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'la ventana de 24h está cerrada', codigo: 'fuera_de_ventana' });
    }
    if (!/^https?:\/\//.test(env.publicBaseUrl)) {
      logger.error('enviarMedia: PUBLIC_BASE_URL no configurada (Meta no podría descargar el adjunto)');
      return res.status(500).json({ error: 'envío de adjuntos no configurado' });
    }

    const esVoz = !!(req.body && (req.body.voz === '1' || req.body.voz === 'true'));
    let buffer = archivo.buffer;
    let contentType = archivo.mimetype;
    let nombreOriginal = archivo.originalname;
    let voice = false;
    if (esVoz) {
      try {
        buffer = await transcodificarAOgg(archivo.buffer);
      } catch (err) {
        logger.error(`transcodificar nota de voz (conv ${req.params.id}): ${err.message}`);
        return res.status(502).json({ error: 'no se pudo procesar el audio', codigo: 'audio' });
      }
      contentType = 'audio/ogg';
      nombreOriginal = 'nota-de-voz.ogg';
      voice = true;
    }

    const categoria = categoriaMedia(contentType);
    const token = crypto.randomBytes(32).toString('hex');
    const guardado = await guardarBufferComoMedia({
      buffer,
      contentType,
      conversacionId: conv.id,
      nombreArchivo: `out-${token}`,
      nombreOriginal,
      fecha: new Date(),
    });
    const tokenPublico = registrar(guardado.mediaRuta, guardado.mediaMime);
    const urlPublica = `${env.publicBaseUrl}/media-publico/${tokenPublico}`;
    const captionFinal = caption || ''; // sin prefijo de firma (ver enviar)

    // Responder = tomar (atómico) antes de enviar; si otro se adelantó, se aborta.
    const toma = await tomarParaEnvio(conv, req.agente);
    if (!toma.ok) return res.status(409).json({ error: 'otro agente ya tomó este chat', codigo: 'tomada' });

    let enviado;
    try {
      enviado = await enviarArchivo({
        ...destinatario1msg(conv.contacto),
        url: urlPublica,
        mediaType: categoria,
        caption: captionFinal,
        filename: guardado.mediaNombre || undefined,
        voice,
      });
    } catch (err) {
      logger.error(`envío media 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      if (toma.tomada) await liberarToma(conv, req.agente.id, toma);
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
    if (toma.tomada) emitirAutoToma(conv.id, req.agente.id);
    const salida = { ...mensaje.toJSON(), enviadoPor: { id: agente.id, nombre: agente.nombre } };
    emitir('mensaje:nuevo', { agenteId: conv.agenteId, general: !conv.agenteId }, { conversacionId: conv.id, mensaje: salida });
    return res.status(201).json({ mensaje: salida });
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
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId', 'telefono', 'bsuid', 'desactivadoEn'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    if (!contactoActivo(conv.contacto)) {
      return res.status(409).json({ error: 'el contacto está desactivado', codigo: 'contacto_desactivado' });
    }
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });

    // Responder = tomar (atómico) antes de enviar; si otro se adelantó, se aborta.
    const toma = await tomarParaEnvio(conv, req.agente);
    if (!toma.ok) return res.status(409).json({ error: 'otro agente ya tomó este chat', codigo: 'tomada' });

    let enviado;
    try {
      const params = [...construirParamsHeader(imagenUrl), ...construirParams(vars)];
      // @lid → phone = bsuid; contacto normal → su teléfono.
      enviado = await enviarPlantillaOnemsg({
        phone: destinatario1msg(conv.contacto).phone || conv.contacto.telefono,
        template,
        namespace: namespace || null,
        language: { code: language || 'es', policy: 'deterministic' },
        params,
      });
    } catch (err) {
      logger.error(`envío plantilla 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      if (toma.tomada) await liberarToma(conv, req.agente.id, toma);
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

    if (toma.tomada) emitirAutoToma(conv.id, req.agente.id);
    const salida = { ...mensaje.toJSON(), enviadoPor: { id: agente.id, nombre: agente.nombre } };
    const destino = { agenteId: conv.agenteId, general: !conv.agenteId };
    emitir('mensaje:nuevo', destino, { conversacionId: conv.id, mensaje: salida });

    return res.status(201).json({ mensaje: salida });
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

async function asignaciones(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const filas = await Asignacion.findAll({
      where: { conversacionId: conv.id },
      order: [['id', 'ASC']],
      include: [
        { model: Agente, as: 'deAgente', attributes: ['nombre'] },
        { model: Agente, as: 'aAgente', attributes: ['nombre'] },
        { model: Agente, as: 'ejecutadoPor', attributes: ['nombre'] },
      ],
    });
    const asignaciones = filas.map((a) => ({
      id: a.id,
      de: a.deAgente ? a.deAgente.nombre : null,
      a: a.aAgente ? a.aAgente.nombre : null,
      ejecutadoPor: a.ejecutadoPor ? a.ejecutadoPor.nombre : null,
      tipo: a.tipo,
      motivo: a.motivo,
      creadoEn: a.creado_en,
    }));
    return res.json({ asignaciones });
  } catch (err) {
    logger.error(`asignaciones ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function etiquetasDeConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    return res.json({ etiquetas: await etiquetasSvc.etiquetasDeConversacion(conv.id) });
  } catch (err) {
    logger.error(`etiquetas de conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function etiquetarConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    const etiquetaId = Number(req.body && req.body.etiquetaId);
    if (!Number.isInteger(etiquetaId)) return res.status(400).json({ error: 'etiquetaId inválido' });
    const etiquetas = await etiquetasSvc.etiquetarConversacion(conv.id, etiquetaId, req.agente.id);
    return res.json({ etiquetas });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'etiqueta no encontrada' });
    logger.error(`etiquetar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

async function desetiquetarConv(req, res) {
  try {
    const conv = await accesible(req, res);
    if (!conv) return undefined;
    await etiquetasSvc.desetiquetarConversacion(conv.id, Number(req.params.etiquetaId));
    return res.json({ ok: true });
  } catch (err) {
    logger.error(`desetiquetar conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}

module.exports = { listarHandler, contadores, mensajes, historial, leer, noLeido, resolver, enviar, enviarMedia, enviarPlantilla, tomar, asignar, agregarNota, listarNotas, asignaciones, etiquetasDeConv, etiquetarConv, desetiquetarConv };
