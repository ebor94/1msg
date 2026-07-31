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

module.exports = { CATEGORIAS, agruparCatalogo };
