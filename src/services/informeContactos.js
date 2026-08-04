'use strict';

const COMPRO = ['si', 'no', 'pendiente'];
const ESTADOS = ['nueva', 'abierta', 'pendiente', 'cerrada'];
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function err422(msg) { const e = new Error(msg); e.status = 422; return e; }

/** Valida y normaliza los filtros del querystring del informe. Puro (sin BD). */
function parsearFiltros(query = {}) {
  const f = {};

  if (query.compro !== undefined && query.compro !== '') {
    if (query.compro === 'sin' || COMPRO.includes(query.compro)) f.compro = query.compro;
    else throw err422('compro inválido');
  }
  if (query.estado !== undefined && query.estado !== '') {
    if (query.estado === 'sin' || ESTADOS.includes(query.estado)) f.estado = query.estado;
    else throw err422('estado inválido');
  }

  const oi = Number(query.origenId);
  if (Number.isInteger(oi) && oi > 0) f.origenId = oi;
  const ii = Number(query.interesId);
  if (Number.isInteger(ii) && ii > 0) f.interesId = ii;

  if (query.desde) {
    const d = new Date(`${query.desde}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw err422('fecha desde inválida');
    f.desde = d;
  }
  if (query.hasta) {
    const h = new Date(`${query.hasta}T00:00:00.000Z`);
    if (Number.isNaN(h.getTime())) throw err422('fecha hasta inválida');
    f.hastaExcl = new Date(h.getTime() + UN_DIA_MS);
  }
  if (f.desde && f.hastaExcl && f.desde >= f.hastaExcl) throw err422('desde > hasta');

  let tam = Number(query.tam);
  if (!Number.isInteger(tam) || tam < 1) tam = 25;
  if (tam > 100) tam = 100;
  let pagina = Number(query.pagina);
  if (!Number.isInteger(pagina) || pagina < 0) pagina = 0;
  f.tam = tam;
  f.pagina = pagina;

  return f;
}

module.exports = { parsearFiltros };
