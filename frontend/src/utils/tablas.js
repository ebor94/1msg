// Helpers de render de tablas (previsión/mantenimiento/prenecesidad). Puros.

export function etiquetaCampo(k) {
  return String(k).replace(/_/g, ' ').replace(/\bplan\b/gi, '').trim().replace(/^\w/, (m) => m.toUpperCase());
}

export function formatoValor(v) {
  if (v == null || v === '') return '—';
  // Fechas de calendario (expedición, vencimiento…): se muestra la parte Y-M-D del
  // string TAL CUAL, sin `new Date()`, para no restar un día por zona horaria (el
  // mssql las devuelve como medianoche UTC; toLocaleDateString las correría a -05:00).
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ]/.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return String(v);
}

// Una columna es "dinero" por su nombre (no por su valor), para no formatear Plazo/# cuotas.
export function esMoneda(col) {
  return /(vr\.?|valor|saldo|abonado|pagado|precio|monto)/i.test(String(col));
}

export function formatoCelda(col, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' && esMoneda(col)) return `$${v.toLocaleString('es-CO')}`;
  return formatoValor(v);
}
