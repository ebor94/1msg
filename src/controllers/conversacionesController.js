'use strict';
const { Op } = require('sequelize');
const { Conversacion, Mensaje, Contacto, Agente } = require('../models');
const { listar, puedeVer } = require('../services/conversaciones');
const { enviarTexto } = require('../integrations/onemsg/envio');
const { ventanaAbierta, conFirma } = require('../services/envio');
const { emitir } = require('../sockets/emisor');
const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE } = require('../config/constants');
const logger = require('../utils/logger');

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

module.exports = { listarHandler, mensajes, leer, enviar };
