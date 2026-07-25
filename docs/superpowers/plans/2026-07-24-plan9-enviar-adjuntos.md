# Plan 9 — Envío de adjuntos (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente adjunte y envíe imágenes/audio/video/documentos al cliente dentro de la ventana de 24h, con botón 📎, pegar (Ctrl/Cmd+V) y arrastrar-soltar.

**Architecture:** `sendFile` de 1msg recibe el archivo como una **URL** que Meta descarga (uploadMedia quedó descartado por no estar documentado — ver spec). El backend guarda una copia propia del archivo, lo expone en una URL pública **efímera e impredecible** (`GET /media-publico/:token`, token aleatorio con TTL corto en memoria), llama a `sendFile(body=urlPublica)`, persiste el saliente y emite por socket. El frontend adjunta por 3 vías (📎/pegar/soltar) hacia el mismo flujo.

**Tech Stack:** Express/Sequelize/axios/`multer`/`node:test` (backend); Vue 3 `<script setup>`/Pinia/Vitest, FormData/Clipboard/Drag-and-Drop API (frontend).

## Global Constraints

- Aislamiento 1msg: solo `src/integrations/onemsg/media.js` habla con 1msg (añade `enviarArchivo`). Ningún otro archivo construye URLs de 1msg.
- `sendFile` exige **ventana de 24h abierta** → el endpoint valida ventana (409 `fuera_de_ventana` si cerrada).
- Persistir **antes** de emitir; idempotencia por `wa_message_id` (`findOrCreate`).
- Rooms, no broadcast: emitir a `{ agenteId: conv.agenteId, general: !conv.agenteId }`.
- Reintento con backoff en 429; errores de 1msg con su código, nunca tragados.
- URL pública: token = 32 bytes aleatorios hex, TTL ~15 min, ruta servida blindada con `rutaMediaSegura` (dentro de `MEDIA_PATH`). Sin token en logs.
- Límite de subida 16 MB (`MEDIA_MAX_UPLOAD_BYTES`, default 16777216). Copia propia en `MEDIA_PATH/{año}/{mes}/{convId}/out-{token}.{ext}`.
- `'use strict'`, CommonJS backend; nombres de dominio en español / técnicos en inglés; sin `console.log`.
- La firma del agente se antepone al `caption` (como en el texto), vía `conFirma(agente.firma, caption)`.

## File Structure

- `src/integrations/onemsg/media.js` (modificar): añadir `enviarArchivo` (POST /sendFile con `body`=URL).
- `src/services/media.js` (modificar): añadir `guardarBufferComoMedia` y `categoriaMedia`.
- `src/services/mediaPublica.js` (crear): store en memoria token→archivo con TTL.
- `src/config/env.js` (modificar): `media.maxUploadBytes` + `publicBaseUrl`. `.env.example` (modificar).
- `src/controllers/mediaController.js` (modificar): añadir `servirPublico`.
- `src/controllers/conversacionesController.js` (modificar): añadir `enviarMedia`.
- `src/routes/api.js` (modificar): multer + ruta `POST /conversaciones/:id/media`.
- `src/routes/index.js` (modificar): ruta pública `GET /media-publico/:token`.
- `frontend/src/stores/acciones.js` (modificar): acción `enviarMedia`.
- `frontend/src/components/Compositor.vue` (modificar): 📎 + pegar + preview + envío.
- `frontend/src/components/VistaChat.vue` (modificar): capa de arrastrar-soltar.

---

### Task 1: onemsg — `enviarArchivo` (sendFile con URL)

**Files:**
- Modify: `src/integrations/onemsg/media.js`
- Test: `test/onemsg-enviararchivo.test.js`

**Interfaces:**
- Produces: `enviarArchivo({ chatId, url, mediaType, caption, filename }, deps?): Promise<{id, sent}>` — POST `/sendFile` form-urlencoded (`body`=url, `mediaType`, `caption`, `filename`, `chatId`), token en query; 429 reintenta; lanza `OneMsgError` si no `sent`.

- [ ] **Step 1: Test**

Crear `test/onemsg-enviararchivo.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enviarArchivo } = require('../src/integrations/onemsg/media');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, post: async (url, body) => { llamadas.push({ url, body }); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('enviarArchivo exitoso manda body=url y mediaType', async () => {
  const http = httpFalso([{ status: 200, data: { sent: true, id: 'wamid.F1' } }]);
  const r = await enviarArchivo({ chatId: '57300@c.us', url: 'https://x/y.jpg', mediaType: 'image', caption: 'hola', filename: 'y.jpg' }, { http });
  assert.equal(r.id, 'wamid.F1');
  assert.match(http.llamadas[0].url, /\/sendFile\?token=/);
  const params = http.llamadas[0].body; // URLSearchParams
  assert.equal(params.get('body'), 'https://x/y.jpg');
  assert.equal(params.get('mediaType'), 'image');
  assert.equal(params.get('chatId'), '57300@c.us');
});

test('enviarArchivo sin sent → OneMsgError', async () => {
  const http = httpFalso([{ status: 200, data: { sent: false, message: 'wrong file' } }]);
  await assert.rejects(() => enviarArchivo({ chatId: '1', url: 'https://x/y.jpg', mediaType: 'image' }, { http, baseMs: 1 }));
});
```

- [ ] **Step 2: Correr → FAIL**

Run (env dummy):
```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/onemsg-enviararchivo.test.js
```
Expected: FAIL (`enviarArchivo is not a function`).

- [ ] **Step 3: Implementar `enviarArchivo` en `src/integrations/onemsg/media.js`**

El archivo ya existe con `descargarMedia`. Añadir imports que falten y la función. Debe quedar (mira el patrón idéntico de `src/integrations/onemsg/envio.js`):

```js
const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(path) {
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/${path}?token=${env.onemsg.token}`;
}

function codigoDe(data) {
  const c = data && (data.error?.code ?? data.error?.error_code ?? data.code);
  return c != null ? String(c) : null;
}

/**
 * Envía un archivo por 1msg (POST /sendFile). El archivo se entrega como una URL
 * pública que Meta descarga (`body`). Reintenta en 429.
 * @returns {Promise<{id:string, sent:boolean}>}
 */
async function enviarArchivo({ chatId, url, mediaType, caption, filename }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const params = new URLSearchParams();
  params.append('body', url);
  if (mediaType) params.append('mediaType', mediaType);
  if (caption) params.append('caption', caption);
  if (filename) params.append('filename', filename);
  params.append('chatId', chatId);

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.post(construirUrl('sendFile'), params, {
        timeout: 30000,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        validateStatus: (s) => s < 500,
      });
      if (r.status === 429) {
        const e = new Error('rate limit de 1msg (429)');
        e.reintentable = true;
        throw e;
      }
      return r;
    },
    { intentos: 3, baseMs, shouldRetry: (e) => e.reintentable === true },
  );

  const data = resp.data || {};
  if (data.sent === true && data.id) return { id: String(data.id), sent: true };
  throw new OneMsgError(data.message || 'envío de archivo no confirmado por 1msg', { codigo: codigoDe(data) });
}
```

Asegurar que `axios`, `env`, `retryWithBackoff`, `OneMsgError`, `construirUrl` existan en el archivo (si `descargarMedia` ya usa algunos, no los dupliques). Añadir `enviarArchivo` al `module.exports` (junto a `descargarMedia`).

- [ ] **Step 4: Correr → PASS** (mismo comando del Step 2).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/onemsg/media.js test/onemsg-enviararchivo.test.js
git commit -m "feat(media): onemsg enviarArchivo (sendFile con URL pública)"
```

---

### Task 2: Servicios de media — guardar buffer, categoría, store público, env

**Files:**
- Modify: `src/services/media.js`
- Create: `src/services/mediaPublica.js`
- Modify: `src/config/env.js`, `.env.example`
- Test: `test/media-servicio.test.js` (existe), `test/media-publica.test.js` (crear)

**Interfaces:**
- Produces:
  - `guardarBufferComoMedia({ buffer, contentType, conversacionId, nombreArchivo, nombreOriginal, fecha }): Promise<{mediaRuta, mediaMime, mediaNombre, mediaBytes}>` — escribe el buffer en `MEDIA_PATH/{año}/{mes}/{convId}/{nombreArchivo}.{ext}` y devuelve los campos para `wa_mensajes`.
  - `categoriaMedia(mime): 'image'|'audio'|'video'|'document'`.
  - `mediaPublica.registrar(rutaRelativa, mime): string` (token hex) ; `mediaPublica.resolver(token, ahora?): {rutaRelativa, mime, expira}|null` ; `mediaPublica.TTL_MS`.
  - `env.media.maxUploadBytes: number` ; `env.publicBaseUrl: string`.
- Consumes: `EXT_POR_MIME`, `sanitizar` (ya en `media.js`).

- [ ] **Step 1: Tests**

Añadir a `test/media-servicio.test.js`:

```js
const { categoriaMedia } = require('../src/services/media');

test('categoriaMedia mapea por mime', () => {
  assert.equal(categoriaMedia('image/png'), 'image');
  assert.equal(categoriaMedia('audio/ogg'), 'audio');
  assert.equal(categoriaMedia('video/mp4'), 'video');
  assert.equal(categoriaMedia('application/pdf'), 'document');
  assert.equal(categoriaMedia(''), 'document');
});
```

Crear `test/media-publica.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registrar, resolver, TTL_MS } = require('../src/services/mediaPublica');

test('registrar → token hex de 64 chars; resolver lo devuelve', () => {
  const token = registrar('2026/07/5/out-x.jpg', 'image/jpeg');
  assert.match(token, /^[a-f0-9]{64}$/);
  const e = resolver(token);
  assert.equal(e.rutaRelativa, '2026/07/5/out-x.jpg');
  assert.equal(e.mime, 'image/jpeg');
});

test('resolver token desconocido → null', () => {
  assert.equal(resolver('nope'), null);
});

test('resolver tras expirar → null', () => {
  const token = registrar('a/b.jpg', 'image/jpeg');
  assert.equal(resolver(token, Date.now() + TTL_MS + 1000), null);
});
```

- [ ] **Step 2: Correr → FAIL**

Run:
```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/media-servicio.test.js test/media-publica.test.js
```
Expected: FAIL.

- [ ] **Step 3: `categoriaMedia` y `guardarBufferComoMedia` en `src/services/media.js`**

Añadir (reutiliza `EXT_POR_MIME` y `sanitizar` ya presentes; `path`, `fs` ya importados):

```js
/** mime → categoría de envío/tipo de mensaje. */
function categoriaMedia(mime) {
  const m = String(mime || '');
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Guarda un buffer (archivo saliente del agente) en disco con la misma convención
 * que la media entrante. `nombreArchivo` es el nombre base sin extensión (ej. out-<token>).
 * @returns campos para wa_mensajes.
 */
async function guardarBufferComoMedia({ buffer, contentType, conversacionId, nombreArchivo, nombreOriginal, fecha }) {
  const ext = EXT_POR_MIME[contentType] || 'bin';
  const cuando = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  const anio = String(cuando.getFullYear());
  const mes = String(cuando.getMonth() + 1).padStart(2, '0');

  const rutaRelativa = path.join(anio, mes, String(conversacionId), `${sanitizar(nombreArchivo)}.${ext}`);
  const rutaAbsoluta = path.join(env.media.path, rutaRelativa);
  await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
  await fs.writeFile(rutaAbsoluta, buffer);

  return {
    mediaRuta: rutaRelativa,
    mediaMime: contentType || 'application/octet-stream',
    mediaNombre: nombreOriginal ? sanitizar(nombreOriginal) : null,
    mediaBytes: buffer.length,
  };
}
```

Añadir `categoriaMedia` y `guardarBufferComoMedia` al `module.exports` (junto a `guardarMediaDeMensaje`, `rutaMediaSegura`).

- [ ] **Step 4: Crear `src/services/mediaPublica.js`**

```js
'use strict';

const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const almacen = new Map(); // token → { rutaRelativa, mime, expira }

/** Elimina entradas vencidas (barrido perezoso; el volumen es bajo). */
function podar(ahora) {
  for (const [k, v] of almacen) {
    if (ahora > v.expira) almacen.delete(k);
  }
}

/** Registra un archivo servible públicamente por un token efímero. */
function registrar(rutaRelativa, mime) {
  const ahora = Date.now();
  podar(ahora);
  const token = crypto.randomBytes(32).toString('hex');
  almacen.set(token, { rutaRelativa, mime, expira: ahora + TTL_MS });
  return token;
}

/** Devuelve la entrada si el token existe y no expiró, o null. */
function resolver(token, ahora = Date.now()) {
  const e = almacen.get(token);
  if (!e) return null;
  if (ahora > e.expira) { almacen.delete(token); return null; }
  return e;
}

module.exports = { registrar, resolver, TTL_MS };
```

- [ ] **Step 5: env — `maxUploadBytes` y `publicBaseUrl`**

En `src/config/env.js`, dentro de `media`:

```js
  media: Object.freeze({
    path: ruta('MEDIA_PATH', './media'),
    maxBytes: entero('MEDIA_MAX_BYTES', 52428800),
    maxUploadBytes: entero('MEDIA_MAX_UPLOAD_BYTES', 16777216),
  }),
```

Y una clave nueva de nivel superior (junto a `webhookSecret`):

```js
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
```

En `.env.example` añadir:

```
# Tamaño máximo de adjuntos salientes (bytes). Default 16 MB.
MEDIA_MAX_UPLOAD_BYTES=16777216
# URL pública base (Cloudflare) para que Meta descargue adjuntos salientes.
PUBLIC_BASE_URL=https://wa.losolivoscucuta.com
```

- [ ] **Step 6: Correr → PASS** (mismo comando del Step 2) y suite completa verde:
```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```

- [ ] **Step 7: Commit**

```bash
git add src/services/media.js src/services/mediaPublica.js src/config/env.js .env.example test/media-servicio.test.js test/media-publica.test.js
git commit -m "feat(media): guardarBufferComoMedia + categoriaMedia + store público efímero + env de subida"
```

---

### Task 3: Endpoints — subir/enviar y ruta pública

**Files:**
- Modify: `src/controllers/conversacionesController.js` (`enviarMedia`)
- Modify: `src/controllers/mediaController.js` (`servirPublico`)
- Modify: `src/routes/api.js` (multer + ruta)
- Modify: `src/routes/index.js` (ruta pública)
- Dependencia: instalar `multer`.

**Interfaces:**
- `POST /api/conversaciones/:id/media` (multipart, campo `archivo`, `caption` opcional) → 201 `{ mensaje }`; 400 sin archivo; 403; 409 `fuera_de_ventana`; 413 archivo grande; 502 fallo 1msg.
- `GET /media-publico/:token` → sirve el archivo o 404.

- [ ] **Step 1: Instalar multer**

```bash
npm install multer
```
Verificar que quede en `dependencies` de `package.json`.

- [ ] **Step 2: `servirPublico` en `src/controllers/mediaController.js`**

Añadir imports y la función (el archivo ya importa `rutaMediaSegura`, `env`, `logger`):

```js
const { resolver } = require('../services/mediaPublica');

/** GET /media-publico/:token — sirve el archivo por token efímero (para que Meta lo descargue). */
async function servirPublico(req, res) {
  try {
    const e = resolver(req.params.token);
    if (!e) return res.status(404).json({ error: 'no disponible' });
    const abs = rutaMediaSegura(e.rutaRelativa, env.media.path);
    if (!abs) return res.status(404).json({ error: 'no disponible' });
    res.setHeader('Content-Type', e.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(abs, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'no disponible' }); });
  } catch (err) {
    logger.error(`media-publico: ${err.message}`);
    if (!res.headersSent) return res.status(500).json({ error: 'error interno' });
    return undefined;
  }
}
```

Exportar `servirPublico` junto a `servir`.

- [ ] **Step 3: `enviarMedia` en `src/controllers/conversacionesController.js`**

Añadir imports que falten: `const crypto = require('crypto');`, `const { guardarBufferComoMedia, categoriaMedia } = require('../services/media');`, `const { registrar } = require('../services/mediaPublica');`, `const { enviarArchivo } = require('../integrations/onemsg/media');`, `const env = require('../config/env');`. (Ya están `Conversacion, Mensaje, Contacto, Agente`, `puedeVer`, `ventanaAbierta`, `conFirma`, `emitir`, `DIRECCION`, `ESTADO_MENSAJE`, `logger`.)

```js
const ETIQUETA_MEDIA = { image: '📷 Imagen', audio: '🎤 Audio', video: '🎬 Video', document: '📄 Documento' };

async function enviarMedia(req, res) {
  const archivo = req.file;
  if (!archivo) return res.status(400).json({ error: 'archivo requerido' });
  const caption = (req.body && req.body.caption ? String(req.body.caption) : '').trim();

  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    const agente = await Agente.findByPk(req.agente.id);
    if (!agente || !agente.activo) return res.status(403).json({ error: 'agente inactivo' });
    if (!ventanaAbierta(conv.ventanaExpiraEn)) {
      return res.status(409).json({ error: 'la ventana de 24h está cerrada', codigo: 'fuera_de_ventana' });
    }

    const categoria = categoriaMedia(archivo.mimetype);
    const token = crypto.randomBytes(32).toString('hex');
    const guardado = await guardarBufferComoMedia({
      buffer: archivo.buffer,
      contentType: archivo.mimetype,
      conversacionId: conv.id,
      nombreArchivo: `out-${token}`,
      nombreOriginal: archivo.originalname,
      fecha: new Date(),
    });
    const tokenPublico = registrar(guardado.mediaRuta, guardado.mediaMime);
    const urlPublica = `${env.publicBaseUrl}/media-publico/${tokenPublico}`;
    const captionFinal = caption ? conFirma(agente.firma, caption) : '';

    let enviado;
    try {
      enviado = await enviarArchivo({
        chatId: conv.contacto.waId,
        url: urlPublica,
        mediaType: categoria,
        caption: captionFinal,
        filename: guardado.mediaNombre || undefined,
      });
    } catch (err) {
      logger.error(`envío media 1msg falló (conv ${conv.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo enviar el archivo', codigo: err.codigo || null });
    }

    const ahora = new Date();
    const desnorm = captionFinal || ETIQUETA_MEDIA[categoria] || '📎 Archivo';
    const [mensaje] = await Mensaje.findOrCreate({
      where: { waMessageId: enviado.id },
      defaults: {
        conversacionId: conv.id, waMessageId: enviado.id, direccion: DIRECCION.OUT,
        tipo: categoria, texto: captionFinal || null,
        mediaRuta: guardado.mediaRuta, mediaMime: guardado.mediaMime,
        mediaNombre: guardado.mediaNombre, mediaBytes: guardado.mediaBytes,
        estado: ESTADO_MENSAJE.ENVIADO, enviadoPorId: agente.id, tsProveedor: ahora,
      },
    });
    await conv.update({ ultimoMensajeEn: ahora, ultimoMensajeTexto: String(desnorm).slice(0, 255), ultimoMensajeDir: DIRECCION.OUT });
    emitir('mensaje:nuevo', { agenteId: conv.agenteId, general: !conv.agenteId }, { conversacionId: conv.id, mensaje });
    return res.status(201).json({ mensaje });
  } catch (err) {
    logger.error(`enviarMedia conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

**IMPORTANTE:** borra la línea `registrar(guardado.mediaRuta, guardado.mediaMime); // devuelve...` duplicada de arriba — solo debe quedar la que asigna `tokenPublico`. (Se dejó el comentario para evitar confusión; en el código final hay UNA sola llamada a `registrar`.)

Exportar `enviarMedia` en `module.exports`. (Nota: hay UNA sola llamada a `registrar`, la que asigna `tokenPublico`.)

- [ ] **Step 4: multer + ruta en `src/routes/api.js`**

Añadir arriba:

```js
const multer = require('multer');
const env = require('../config/env');
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.media.maxUploadBytes } });

function subirUno(req, res, next) {
  subida.single('archivo')(req, res, (err) => {
    if (!err) return next();
    const grande = err.code === 'LIMIT_FILE_SIZE';
    return res.status(grande ? 413 : 400).json({ error: grande ? 'archivo demasiado grande (máx 16 MB)' : 'archivo inválido' });
  });
}
```

Y la ruta (junto a las de conversaciones):

```js
router.post('/conversaciones/:id/media', requireAuth, subirUno, convCtrl.enviarMedia);
```

- [ ] **Step 5: ruta pública en `src/routes/index.js`**

```js
const { servirPublico } = require('../controllers/mediaController');
// ... junto a /webhook y /health, ANTES del fallback SPA (que vive en app.js tras el router):
router.get('/media-publico/:token', servirPublico);
```

- [ ] **Step 6: Verificar carga + suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y suite verde.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/conversacionesController.js src/controllers/mediaController.js src/routes/api.js src/routes/index.js package.json package-lock.json
git commit -m "feat(media): POST /conversaciones/:id/media (subir+enviar) y ruta pública efímera"
```

---

### Task 4: Frontend — adjuntar (📎 + pegar + arrastrar-soltar)

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/Compositor.vue`
- Modify: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Produces: `acciones.enviarMedia(convId, file, caption): Promise<mensaje>` (POST multipart; hace push del mensaje al chat).

- [ ] **Step 1: Store `enviarMedia`**

En `frontend/src/stores/acciones.js` (importa `tokenGuardado` de `../api/cliente` — añádelo al import existente de `apiFetch`), añadir acción:

```js
    async enviarMedia(convId, file, caption) {
      const fd = new FormData();
      fd.append('archivo', file);
      if (caption) fd.append('caption', caption);
      const token = tokenGuardado();
      const resp = await fetch(`/api/conversaciones/${convId}/media`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let cuerpo = null;
      try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }
      if (!resp.ok) {
        const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`);
        e.status = resp.status;
        if (cuerpo && cuerpo.codigo) e.codigo = cuerpo.codigo;
        throw e;
      }
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId && !chat.mensajes.some((m) => m.id === cuerpo.mensaje.id)) {
        chat.mensajes.push(cuerpo.mensaje);
      }
      return cuerpo.mensaje;
    },
```

(Asegura `import { apiFetch, tokenGuardado } from '../api/cliente';` y `import { useChat } from './chat';` — este último ya existe en el store.)

- [ ] **Step 2: Compositor — 📎, pegar y preview**

Reemplazar el `<script setup>` de `frontend/src/components/Compositor.vue` por:

```vue
<script setup>
import { ref, computed } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { ventanaAbierta } from '../utils/formato';
import SelectorPlantilla from './SelectorPlantilla.vue';

const chat = useChat();
const acc = useAcciones();
const texto = ref('');
const mostrarSelector = ref(false);
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));

// Adjunto pendiente de enviar (elegido por 📎, pegar o soltar).
const adjunto = ref(null); // File
const previewUrl = ref('');
const captionAdj = ref('');
const enviandoAdj = ref(false);
const errorAdj = ref('');
const fileInput = ref(null);

const MAX = 16 * 1024 * 1024;

function tomarArchivo(file) {
  if (!file) return;
  if (file.size > MAX) { errorAdj.value = 'El archivo supera 16 MB.'; return; }
  errorAdj.value = '';
  adjunto.value = file;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
}
function elegirArchivo(e) { tomarArchivo(e.target.files[0]); e.target.value = ''; }
function onPaste(e) {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
  if (item) { e.preventDefault(); tomarArchivo(item.getAsFile()); }
}
function cancelarAdj() {
  adjunto.value = null;
  captionAdj.value = '';
  errorAdj.value = '';
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}
async function enviarAdj() {
  if (!adjunto.value || enviandoAdj.value) return;
  enviandoAdj.value = true;
  errorAdj.value = '';
  try {
    await acc.enviarMedia(chat.conversacion.id, adjunto.value, captionAdj.value.trim());
    cancelarAdj();
  } catch (e) {
    errorAdj.value = e.codigo === 'fuera_de_ventana' ? 'La ventana de 24h está cerrada.' : (e.status === 413 ? 'El archivo supera 16 MB.' : 'No se pudo enviar el archivo.');
  } finally {
    enviandoAdj.value = false;
  }
}

// Expuesto para que VistaChat (drag-and-drop) entregue el archivo.
defineExpose({ tomarArchivo });

async function enviar() {
  const t = texto.value.trim();
  if (!t || chat.enviando) return;
  texto.value = '';
  await chat.enviar(t);
}
</script>

<template>
  <div class="bg-[#f0f2f5] border-t border-gray-200 p-2.5">
    <!-- Preview de adjunto -->
    <div v-if="adjunto" class="bg-white rounded-lg p-2 mb-2 shadow-sm">
      <div class="flex items-center gap-2">
        <img v-if="previewUrl" :src="previewUrl" class="w-14 h-14 object-cover rounded" alt="" />
        <span v-else class="text-2xl">📄</span>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] truncate">{{ adjunto.name }}</div>
          <div class="text-[11px] text-gray-400">{{ (adjunto.size / 1024 / 1024).toFixed(2) }} MB</div>
        </div>
        <button class="text-gray-400 text-sm" @click="cancelarAdj">✕</button>
      </div>
      <input v-model="captionAdj" placeholder="Añadir un comentario…" class="w-full mt-2 border rounded px-2 py-1.5 text-[13px]" />
      <div v-if="errorAdj" class="text-[12px] text-red-500 mt-1">{{ errorAdj }}</div>
      <button :disabled="enviandoAdj" @click="enviarAdj"
        class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-60">
        {{ enviandoAdj ? 'Enviando…' : 'Enviar archivo' }}
      </button>
    </div>

    <div v-if="!abierta && !adjunto" class="text-center text-[12px] text-amber-700 bg-amber-50 rounded py-2 px-2">
      Fuera de la ventana de 24h.
      <button class="ml-2 underline text-marca-oscuro font-semibold" @click="mostrarSelector = true">Usar plantilla</button>
    </div>
    <div v-else-if="!adjunto" class="flex items-center gap-2">
      <button @click="mostrarSelector = true" title="Usar plantilla"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">📄</button>
      <button @click="fileInput.click()" title="Adjuntar archivo"
        class="w-10 h-10 rounded-full bg-white text-marca-oscuro grid place-items-center shrink-0 hover:bg-gray-100">📎</button>
      <input ref="fileInput" type="file" class="hidden" @change="elegirArchivo" />
      <input v-model="texto" @keydown.enter="enviar" @paste="onPaste" :disabled="chat.enviando"
        placeholder="Escribe un mensaje…" class="flex-1 bg-white rounded-full px-4 py-2 text-[13px] outline-none" />
      <button @click="enviar" :disabled="chat.enviando || !texto.trim()"
        class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center disabled:opacity-50">➤</button>
    </div>

    <div v-if="chat.errorEnvio" class="text-center text-[12px] text-red-600 mt-1">{{ chat.errorEnvio }}</div>
    <SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector = false" />
  </div>
</template>
```

- [ ] **Step 3: VistaChat — capa de arrastrar-soltar**

En `frontend/src/components/VistaChat.vue`: referencia al Compositor y overlay de drop. Añadir en `<script setup>` (adaptar a lo existente — el componente ya importa `useChat` y renderiza `<Compositor>`):

```js
import { ref } from 'vue';
const compositorRef = ref(null);
const arrastrando = ref(false);
function onDrop(e) {
  arrastrando.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file && compositorRef.value) compositorRef.value.tomarArchivo(file);
}
```

En el template: envolver el área del chat con manejadores y overlay, y pasar la ref al Compositor:

```vue
<div class="relative flex flex-col h-full" @dragover.prevent="arrastrando = true" @dragleave.prevent="arrastrando = false" @drop.prevent="onDrop">
  <!-- ...mensajes... -->
  <Compositor ref="compositorRef" v-if="chat.conversacion" />
  <div v-if="arrastrando" class="absolute inset-0 bg-marca/10 border-2 border-dashed border-marca grid place-items-center z-10 pointer-events-none">
    <span class="text-marca-oscuro font-semibold">Suelta para adjuntar</span>
  </div>
</div>
```

(Ajusta las clases al layout real de `VistaChat.vue` sin romper el scroll de mensajes; el `<Compositor ref="compositorRef">` es el cambio clave más el overlay.)

- [ ] **Step 4: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/Compositor.vue frontend/src/components/VistaChat.vue
git commit -m "feat(frontend): adjuntar y enviar archivos (📎 + pegar + arrastrar-soltar)"
```

---

### Task 5: Despliegue + prueba real

- [ ] **Step 1: env de producción.** En el servidor, añadir a `~/apps/wa/.env`: `PUBLIC_BASE_URL=https://wa.losolivoscucuta.com` (y opcional `MEDIA_MAX_UPLOAD_BYTES=16777216`). Confirmar que existe.
- [ ] **Step 2: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm ci` (para instalar `multer`), `npm --prefix frontend ci --include=dev && npm --prefix frontend run build`, `pm2 restart wa-backend --update-env`. `/health` 200.
- [ ] **Step 3: Prueba real.** En un chat con ventana abierta (un cliente que haya escrito hace poco, o tu propio número tras escribir "hola"): (a) 📎 elegir una imagen + comentario → enviar; (b) pegar una captura con Ctrl/Cmd+V → enviar; (c) arrastrar un PDF al chat → enviar. Confirmar en el WhatsApp del cliente que llegan los 3, y en la bandeja que aparecen como salientes (imagen/documento se ven vía el visor del Plan 8). Verificar que fuera de ventana el 📎 no está y responde 409 si se fuerza.

---

## Notas de cobertura del spec (Plan 9)

Cubre: subir+enviar por `sendFile` con URL pública efímera (uploadMedia descartado), ruta pública con token TTL, copia propia en disco, persistir-antes-de-emitir idempotente, validación de ventana/tamaño/tipo, firma en caption, y las 3 entradas del frontend (📎/pegar/arrastrar-soltar) con preview+caption+progreso. **Fuera de alcance:** múltiples archivos por mensaje, recorte/edición de imagen, transcodificación. Los endpoints HTTP se validan en la prueba real (el proyecto no tiene scaffolding HTTP/DB).
