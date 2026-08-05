// Umbrales visuales (solo color). Espera: >30 ámbar, >60 rojo. TPR: >10 ámbar, >30 rojo.
export function colorEspera(min) {
  if (min == null) return 'none';
  if (min > 60) return 'bad';
  if (min > 30) return 'warn';
  return 'ok';
}
export function colorTpr(min) {
  if (min == null) return 'none';
  if (min > 30) return 'bad';
  if (min > 10) return 'warn';
  return 'ok';
}
export function minAHhMm(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
