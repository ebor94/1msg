'use strict';
// Utilidades PURAS para cargar destinatarios de una difusión desde CSV/pegado.
// Sin BD, sin red.

/** Normaliza a waId colombiano: 57 + 10 dígitos, celular empieza en 3. */
function validarTelefonoCo(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  let local = d;
  if (local.length === 12 && local.startsWith('57')) local = local.slice(2);
  // waId canónico del sistema = '<telefono>@c.us' (así lo crea la ingesta desde el
  // chatId de 1msg); el teléfono va pelado para el envío a 1msg.
  if (local.length === 10 && local.startsWith('3')) return { ok: true, waId: `57${local}@c.us`, telefono: `57${local}` };
  return { ok: false };
}

/** CSV simple: primera línea = cabeceras, separador coma, sin comillas complejas. */
function parsearCsv(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return { cabeceras: [], filas: [] };
  const cabeceras = lineas[0].split(',').map((c) => c.trim());
  const filas = lineas.slice(1).map((l) => {
    const celdas = l.split(',');
    const obj = {};
    cabeceras.forEach((c, i) => { obj[c] = (celdas[i] ?? '').trim(); });
    return obj;
  });
  return { cabeceras, filas };
}

/** Exige que el CSV traiga todas las columnas requeridas por el mapeo. */
function validarColumnas(cabeceras, mapeo) {
  const req = [mapeo.telefono, mapeo.agente,
    ...(mapeo.variables || []).filter((v) => v.tipo === 'columna').map((v) => v.columna)];
  const faltan = req.filter((c) => !cabeceras.includes(c));
  if (faltan.length) { const e = new Error(`faltan columnas: ${faltan.join(', ')}`); e.status = 400; throw e; }
}

/** Arma los destinatarios; marca 'omitido' (con motivo) los que no se enviarán. */
function construirDestinatarios({ filas, mapeo, agentesActivos }) {
  const activos = new Set((agentesActivos || []).map(Number));
  const colNombre = mapeo.nombre || 'NOMBRE'; // columna con el nombre del contacto (por defecto 'NOMBRE')
  const colCedula = mapeo.cedula || 'CEDULA'; // columna con la cédula (para el resumen → gestión)
  return filas.map((fila) => {
    const tel = validarTelefonoCo(fila[mapeo.telefono]);
    const agenteId = Number(String(fila[mapeo.agente] || '').replace(/\D/g, ''));
    const parametros = (mapeo.variables || []).map((v) =>
      v.tipo === 'fijo' ? String(v.valor ?? '') : String(fila[v.columna] ?? ''));
    const nombre = fila[colNombre] != null && String(fila[colNombre]).trim() !== '' ? String(fila[colNombre]).trim() : null;
    const documento = String(fila[colCedula] || '').replace(/\D/g, '') || null;
    if (!tel.ok) return { telefono: String(fila[mapeo.telefono] || ''), parametros, agenteId: null, nombre, documento, estado: 'omitido', motivo: 'telefono invalido' };
    if (!Number.isInteger(agenteId) || !activos.has(agenteId)) {
      return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId: null, nombre, documento, estado: 'omitido', motivo: 'agente invalido' };
    }
    return { telefono: tel.telefono, waId: tel.waId, parametros, agenteId, nombre, documento, estado: 'pendiente', motivo: null };
  });
}

module.exports = { validarTelefonoCo, parsearCsv, validarColumnas, construirDestinatarios };
