'use strict';

const CATEGORIAS = Object.freeze({ ORIGEN: 'origen', INTERES: 'interes' });

/** Separa el catálogo en {origen, interes}, cada grupo ordenado por orden y nombre. */
function agruparCatalogo(filas) {
  const cmp = (a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es');
  return {
    origen: filas.filter((e) => e.categoria === CATEGORIAS.ORIGEN).sort(cmp),
    interes: filas.filter((e) => e.categoria === CATEGORIAS.INTERES).sort(cmp),
  };
}

const { Etiqueta, ConversacionEtiqueta } = require('../models');
const { sequelize } = require('../config/database');

const ATTRS = ['id', 'nombre', 'categoria', 'color', 'orden'];

async function listarCatalogo() {
  const filas = await Etiqueta.findAll({ where: { activa: true }, attributes: ATTRS });
  return agruparCatalogo(filas.map((f) => f.get({ plain: true })));
}

async function etiquetasDeConversacion(convId) {
  const filas = await ConversacionEtiqueta.findAll({
    where: { conversacionId: convId },
    include: [{ model: Etiqueta, as: 'etiqueta', attributes: ATTRS }],
  });
  return filas.map((f) => f.etiqueta.get({ plain: true }));
}

async function etiquetarConversacion(convId, etiquetaId, agenteId) {
  const etq = await Etiqueta.findByPk(etiquetaId);
  if (!etq || !etq.activa) {
    const e = new Error('etiqueta no encontrada');
    e.status = 404;
    throw e;
  }
  await sequelize.transaction(async (tx) => {
    // Regla "1 origen": al poner un origen se retira cualquier otro origen del chat.
    if (etq.categoria === CATEGORIAS.ORIGEN) {
      await sequelize.query(
        `DELETE ce FROM wa_conversacion_etiqueta ce
           JOIN wa_etiquetas e ON e.id = ce.etiqueta_id
          WHERE ce.conversacion_id = :conv AND e.categoria = 'origen'
            AND ce.etiqueta_id <> :etiquetaId`,
        { replacements: { conv: convId, etiquetaId }, transaction: tx },
      );
    }
    await ConversacionEtiqueta.findOrCreate({
      where: { conversacionId: convId, etiquetaId },
      defaults: { conversacionId: convId, etiquetaId, agenteId },
      transaction: tx,
    });
  });
  return etiquetasDeConversacion(convId);
}

async function desetiquetarConversacion(convId, etiquetaId) {
  await ConversacionEtiqueta.destroy({ where: { conversacionId: convId, etiquetaId } });
}

const { QueryTypes } = require('sequelize');

const RE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function normalizarRango(desdeStr, hastaStr) {
  const desde = new Date(`${desdeStr}T00:00:00.000Z`);
  const hasta = new Date(`${hastaStr}T00:00:00.000Z`);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    const e = new Error('fechas inválidas'); e.status = 400; throw e;
  }
  if (desde > hasta) { const e = new Error('desde > hasta'); e.status = 400; throw e; }
  return { desde, hastaExclusivo: new Date(hasta.getTime() + UN_DIA_MS) };
}

function validarNuevaEtiqueta({ nombre, categoria, color } = {}) {
  const nom = String(nombre || '').trim();
  if (!nom || nom.length > 60) { const e = new Error('nombre inválido'); e.status = 422; throw e; }
  if (categoria !== CATEGORIAS.ORIGEN && categoria !== CATEGORIAS.INTERES) {
    const e = new Error('categoría inválida'); e.status = 422; throw e;
  }
  const col = color == null || color === '' ? '#888780' : String(color);
  if (!RE_COLOR.test(col)) { const e = new Error('color inválido'); e.status = 422; throw e; }
  return { nombre: nom, categoria, color: col };
}

async function estadisticas({ desde, hastaExclusivo, categoria }) {
  const filtroCat = categoria ? 'AND e.categoria = :categoria' : '';
  return sequelize.query(
    `SELECT e.id, e.nombre, e.categoria, e.color, COUNT(*) AS total
       FROM wa_conversacion_etiqueta ce
       JOIN wa_etiquetas e        ON e.id = ce.etiqueta_id
       JOIN wa_conversaciones c   ON c.id = ce.conversacion_id
      WHERE c.creado_en >= :desde AND c.creado_en < :hastaExclusivo ${filtroCat}
      GROUP BY e.id, e.nombre, e.categoria, e.color
      ORDER BY e.categoria, total DESC`,
    { type: QueryTypes.SELECT, replacements: { desde, hastaExclusivo, categoria } },
  );
}

async function crearEtiqueta(datos) {
  const limpio = validarNuevaEtiqueta(datos);
  return Etiqueta.create({ ...limpio, activa: true, orden: Number(datos.orden) || 0 });
}

async function actualizarEtiqueta(id, cambios) {
  const etq = await Etiqueta.findByPk(id);
  if (!etq) { const e = new Error('no encontrada'); e.status = 404; throw e; }
  const permitidos = {};
  if (cambios.nombre !== undefined) {
    const nom = String(cambios.nombre).trim();
    if (!nom || nom.length > 60) { const e = new Error('nombre inválido'); e.status = 422; throw e; }
    permitidos.nombre = nom;
  }
  if (cambios.color !== undefined) {
    if (!RE_COLOR.test(String(cambios.color))) { const e = new Error('color inválido'); e.status = 422; throw e; }
    permitidos.color = String(cambios.color);
  }
  if (cambios.activa !== undefined) permitidos.activa = !!cambios.activa;
  if (cambios.orden !== undefined) permitidos.orden = Number(cambios.orden) || 0;
  await etq.update(permitidos);
  return etq;
}

async function listarCatalogoCompleto() {
  const filas = await Etiqueta.findAll({ attributes: [...ATTRS, 'activa'] });
  return agruparCatalogo(filas.map((f) => f.get({ plain: true })));
}

module.exports = {
  CATEGORIAS,
  agruparCatalogo,
  listarCatalogo,
  listarCatalogoCompleto,
  etiquetasDeConversacion,
  etiquetarConversacion,
  desetiquetarConversacion,
  normalizarRango,
  validarNuevaEtiqueta,
  estadisticas,
  crearEtiqueta,
  actualizarEtiqueta,
};
