'use strict';
const logger = require('../utils/logger');
const servicioReal = require('../services/difusiones');
const { guardarImagen } = require('../services/difusionImagen');
const { Difusion } = require('../models');

let servicio = servicioReal;
function _setServicio(s) { servicio = { ...servicioReal, ...s }; }

function fallo(res, err, msgGenerico) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  logger.error(msgGenerico + ': ' + err.message);
  return res.status(500).json({ error: msgGenerico });
}

async function crear(req, res) {
  try {
    const b = req.body || {};
    if (!b.nombre || !b.plantilla) return res.status(400).json({ error: 'nombre y plantilla son obligatorios' });
    const dif = await servicio.crear({
      nombre: b.nombre, plantilla: b.plantilla, idioma: b.idioma, categoria: b.categoria,
      requiereResumen: b.requiereResumen, carrusel: b.carrusel, creadoPorId: req.agente.id,
    });
    return res.status(201).json({ difusion: dif });
  } catch (err) { return fallo(res, err, 'no se pudo crear la difusión'); }
}

async function cargar(req, res) {
  try {
    const { texto, mapeo } = req.body || {};
    if (!texto || !mapeo) return res.status(400).json({ error: 'texto y mapeo son obligatorios' });
    const r = await servicio.cargarDestinatarios(req.params.id, { texto, mapeo });
    return res.json(r);
  } catch (err) { return fallo(res, err, 'no se pudieron cargar los destinatarios'); }
}

async function subirImagen(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo' });
    const { url } = await guardarImagen(req.params.id, req.file.buffer, req.file.mimetype);
    await Difusion.update({ imagenUrl: url }, { where: { id: req.params.id } });
    return res.json({ imagenUrl: url });
  } catch (err) { return fallo(res, err, 'no se pudo subir la imagen'); }
}

async function subirImagenCarrusel(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo' });
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'índice de tarjeta inválido' });
    const dif = await Difusion.findByPk(req.params.id);
    if (!dif) return res.status(404).json({ error: 'difusión no encontrada' });
    if (!dif.carrusel || !Array.isArray(dif.carrusel.cards) || !dif.carrusel.cards[idx]) {
      return res.status(400).json({ error: 'la difusión no tiene esa tarjeta de carrusel' });
    }
    const { url } = await guardarImagen(req.params.id, req.file.buffer, req.file.mimetype, idx);
    // Sequelize no detecta la mutación in-place de un campo JSON: se asigna un objeto nuevo.
    const carrusel = { ...dif.carrusel, cards: dif.carrusel.cards.map((c, i) => (i === idx ? { ...c, imagenUrl: url } : c)) };
    await dif.update({ carrusel });
    return res.json({ imagenUrl: url });
  } catch (err) { return fallo(res, err, 'no se pudo subir la imagen de la tarjeta'); }
}

async function iniciar(req, res) {
  try { await servicio.iniciar(req.params.id); return res.json({ ok: true }); }
  catch (err) { return fallo(res, err, 'no se pudo iniciar la difusión'); }
}
async function cancelar(req, res) {
  try { await servicio.cancelar(req.params.id); return res.json({ ok: true }); }
  catch (err) { return fallo(res, err, 'no se pudo cancelar la difusión'); }
}
async function listar(req, res) {
  try { return res.json({ difusiones: await servicio.listar() }); }
  catch (err) { return fallo(res, err, 'no se pudieron listar las difusiones'); }
}
async function detalle(req, res) {
  try { return res.json(await servicio.detalle(req.params.id)); }
  catch (err) { return fallo(res, err, 'no se pudo obtener la difusión'); }
}
async function destinatarios(req, res) {
  try {
    const pagina = Number(req.query.pagina) || 0;
    return res.json(await servicio.destinatarios(req.params.id, { estado: req.query.estado, pagina }));
  } catch (err) { return fallo(res, err, 'no se pudieron listar los destinatarios'); }
}

module.exports = { crear, cargar, subirImagen, subirImagenCarrusel, iniciar, cancelar, listar, detalle, destinatarios, _setServicio };
