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
          WHERE ce.conversacion_id = :conv AND e.categoria = 'origen'`,
        { replacements: { conv: convId }, transaction: tx },
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

module.exports = {
  CATEGORIAS,
  agruparCatalogo,
  listarCatalogo,
  etiquetasDeConversacion,
  etiquetarConversacion,
  desetiquetarConversacion,
};
