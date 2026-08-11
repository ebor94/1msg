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

// Columnas que el CSV debe traer, según el mapeo. Si la difusión requiere resumen,
// exige además la columna CEDULA (para mapear cada cliente a su plan de previsión).
export function columnasRequeridas(mapeo, requiereResumen) {
  const cols = [mapeo.telefono, mapeo.agente];
  (mapeo.variables || []).forEach((v) => { if (v.tipo === 'columna' && v.columna) cols.push(v.columna); });
  if (requiereResumen) cols.push('CEDULA');
  return [...new Set(cols)];
}
