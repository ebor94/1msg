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
    if (cuerpo && cuerpo.codigo) e.codigo = cuerpo.codigo;
    throw e;
  }
  return cuerpo;
}

export async function fetchMediaBlob(ruta) {
  const token = tokenGuardado();
  const resp = await fetch(`/api${ruta}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    const e = new Error(`media ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  const blob = await resp.blob();
  const disp = resp.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/.exec(disp);
  return { blob, url: URL.createObjectURL(blob), filename: m ? m[1] : null, mime: blob.type };
}

export { CLAVE_TOKEN };
