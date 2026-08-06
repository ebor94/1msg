// frontend/src/utils/difusion.js
// Helpers puros para el asistente de difusiones (vista previa + mapeo). Sin red.

export function renderizarCuerpo(cuerpo, valores) {
  return String(cuerpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? '');
}

export function parsearCsvPreview(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return { cabeceras: [], primera: null };
  const cabeceras = lineas[0].split(',').map((c) => c.trim());
  let primera = null;
  if (lineas.length > 1) {
    const celdas = lineas[1].split(',');
    primera = {};
    cabeceras.forEach((c, i) => { primera[c] = (celdas[i] ?? '').trim(); });
  }
  return { cabeceras, primera };
}

export function valorDeVariable(v, fila) {
  if (v.tipo === 'fijo') return String(v.valor ?? '');
  return String((fila && fila[v.columna]) ?? '');
}
