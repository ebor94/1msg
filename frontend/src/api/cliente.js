const CLAVE_TOKEN = 'wa_token';

export function tokenGuardado() {
  return localStorage.getItem(CLAVE_TOKEN);
}

export async function apiFetch(ruta, opciones = {}) {
  const cabeceras = { 'content-type': 'application/json', ...(opciones.headers || {}) };
  const token = tokenGuardado();
  if (token) cabeceras.authorization = `Bearer ${token}`;

  const resp = await fetch(`/api${ruta}`, { ...opciones, headers: cabeceras });
  let cuerpo = null;
  try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }

  if (resp.status === 401) {
    localStorage.removeItem(CLAVE_TOKEN);
    const e = new Error((cuerpo && cuerpo.error) || 'no autenticado');
    e.status = 401;
    throw e;
  }
  if (!resp.ok) {
    const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return cuerpo;
}

export { CLAVE_TOKEN };
