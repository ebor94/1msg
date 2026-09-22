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

// Estado editable del wizard para una plantilla de carrusel (o null si no lo es).
export function initCarrusel(def) {
  const c = def && def.carrusel;
  if (!c) return null;
  return {
    bodyVars: Array.from({ length: c.bodyVars || 0 }, () => ''),
    cards: (c.cards || []).map((card) => ({
      vars: Array.from({ length: card.variables || 0 }, () => ''),
      imagenFile: null,
      imagenUrl: null,
    })),
  };
}

// Contenido del carrusel que va al backend en `crear` (las imágenes se suben aparte).
export function carruselBackend(estado) {
  return {
    bodyVars: [...((estado && estado.bodyVars) || [])],
    cards: ((estado && estado.cards) || []).map((c) => ({ vars: [...(c.vars || [])] })),
  };
}

export const LIMITE_CUERPO_CARRUSEL = 160;
export const LIMITE_CUERPO_GENERAL = 1024;

// Largo del texto ya rellenado con sus variables (como lo mide WhatsApp).
export function largoHidratado(texto, vars) {
  return renderizarCuerpo(texto || '', vars || []).length;
}

// True si el encabezado (>1024) o alguna tarjeta (>160) excede su límite.
export function carruselExcedeLimite(plantilla, carrusel) {
  if (!plantilla || !plantilla.carrusel || !carrusel) return false;
  if (largoHidratado(plantilla.cuerpo, carrusel.bodyVars) > LIMITE_CUERPO_GENERAL) return true;
  return (carrusel.cards || []).some((card, i) => {
    const texto = plantilla.carrusel.cards[i] && plantilla.carrusel.cards[i].texto;
    return largoHidratado(texto, card.vars) > LIMITE_CUERPO_CARRUSEL;
  });
}
