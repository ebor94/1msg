export function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return partes.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function horaCorta(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
}

const ICONO_ESTADO = {
  pendiente: '🕓', enviado: '✓', entregado: '✓✓', leido: '✓✓', fallido: '⚠',
};
export function iconoEstado(estado) {
  return ICONO_ESTADO[estado] || '';
}

export function esLeido(estado) {
  return estado === 'leido';
}

const ETIQUETA_TIPO = {
  image: '[imagen]', audio: '[audio]', video: '[video]', document: '[documento]', sticker: '[sticker]',
};
export function etiquetaTipo(tipo) {
  return ETIQUETA_TIPO[tipo] || null;
}

export function ventanaAbierta(fecha) {
  if (!fecha) return false;
  const d = new Date(fecha);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

export function tamanoLegible(bytes) {
  if (!bytes || bytes < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
