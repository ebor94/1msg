# Plan 10 — Recuperar historial del chat (backfill) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al abrir un chat, recuperar el historial completo desde 1msg (`GET /messages`), guardarlo idempotente en `wa_mensajes` con sus medios, y permitir scroll hacia atrás.

**Architecture:** Cliente aislado `onemsg/historial.js` (paginación por `lastMessageNumber`, cursor desde 0 avanzando con el mayor `messageNumber`). Servicio `backfill.js` recorre todas las páginas, normaliza con el normalizador del webhook, hace upsert por `wa_message_id` y descarga medios; corre una vez por chat (`wa_conversaciones.historial_recuperado_en`). Endpoint `POST /conversaciones/:id/historial` lo dispara. El cursor de paginación de mensajes se cambia a keyset `(ts_proveedor, id)` para que el scroll hacia atrás funcione con mensajes viejos insertados con id nuevo. Frontend: dispara backfill al abrir y carga más al hacer scroll arriba.

**Tech Stack:** Express/Sequelize/axios/`node:test` (backend); Vue 3/Pinia/Vitest (frontend).

## Global Constraints

- Aislamiento 1msg: solo `src/integrations/onemsg/historial.js` arma la URL de `/messages`. Token en query, nunca al frontend ni en logs.
- Idempotencia: `Mensaje.findOrCreate` por `waMessageId`; el backfill nunca duplica ni pisa lo ingerido por webhook.
- Paginación de `/messages`: `GET …/messages?token=…&chatId={waId}&lastMessageNumber={cursor}&limit={L}`. `lastMessageNumber=0` → los más viejos; cursor = mayor `messageNumber` de la página; página con `< L` = última. Reintento 429.
- El normalizador NO se toca: `/messages` trae `self` (1=saliente/out, 0=entrante/in), que `normalizarMensaje` ya usa.
- Backfill **una vez por chat** (marca `historial_recuperado_en`); descarga de medios best-effort (URLs expiran ~5 min), concurrencia limitada, un fallo no aborta.
- Orden de visualización por `ts_proveedor`; cursor de scroll = keyset `(ts_proveedor, id)`.
- `'use strict'`, CommonJS backend; nombres de dominio en español / técnicos en inglés; sin `console.log`.

## File Structure

- `src/integrations/onemsg/historial.js` (crear): `paginaHistorial`.
- `src/services/backfill.js` (crear): `recuperarHistorial`.
- `docs/migraciones/002-historial-recuperado.sql` (crear) + `src/models/conversacion.js` (campo).
- `src/controllers/conversacionesController.js` (modificar): handler `historial` + cambiar el cursor de `mensajes` a keyset.
- `src/routes/api.js` (modificar): ruta `POST /conversaciones/:id/historial`.
- `frontend/src/stores/chat.js` (modificar): `recuperarHistorial`, `cargarMas`, estado `recuperando/hayMas/cargandoMas`.
- `frontend/src/components/VistaChat.vue` (modificar): scroll hacia arriba + preservar posición + indicador.

---

### Task 1: Cliente onemsg `historial.js` + verificación del normalizador

**Files:**
- Create: `src/integrations/onemsg/historial.js`
- Test: `test/onemsg-historial.test.js`, `test/normalizador-historial.test.js`

**Interfaces:**
- Produces: `paginaHistorial({ chatId, lastMessageNumber = 0, limit = 100 }, deps?): Promise<Array>` — GET `/messages` query params; reintenta 429; devuelve `data.messages || []`; `OneMsgError` en fallo.

- [ ] **Step 1: Tests**

`test/onemsg-historial.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paginaHistorial } = require('../src/integrations/onemsg/historial');

function httpFalso(respuestas) {
  const llamadas = [];
  return { llamadas, get: async (url) => { llamadas.push(url); const r = respuestas[llamadas.length - 1]; if (r instanceof Error) throw r; return r; } };
}

test('paginaHistorial arma la query y devuelve messages', async () => {
  const http = httpFalso([{ status: 200, data: { messages: [{ id: 'a', messageNumber: 5 }] } }]);
  const r = await paginaHistorial({ chatId: '57300@c.us', lastMessageNumber: 0, limit: 100 }, { http });
  assert.equal(r.length, 1);
  assert.match(http.llamadas[0], /\/messages\?/);
  assert.match(http.llamadas[0], /chatId=57300%40c\.us|chatId=57300@c\.us/);
  assert.match(http.llamadas[0], /lastMessageNumber=0/);
  assert.match(http.llamadas[0], /limit=100/);
});

test('paginaHistorial sin messages → []', async () => {
  const http = httpFalso([{ status: 200, data: {} }]);
  const r = await paginaHistorial({ chatId: 'x' }, { http });
  assert.deepEqual(r, []);
});

test('paginaHistorial ≥400 → OneMsgError', async () => {
  const http = httpFalso([{ status: 401, data: { error: { code: 'x' } } }]);
  await assert.rejects(() => paginaHistorial({ chatId: 'x' }, { http, baseMs: 1 }));
});
```

`test/normalizador-historial.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizarMensaje } = require('../src/services/normalizador');

test('mensaje de /messages: self=1 → out', () => {
  const n = normalizarMensaje({ id: 'w1', type: 'chat', body: 'hola', self: 1, fromMe: 1, time: 1779290079, chatId: '57300@c.us' });
  assert.equal(n.direccion, 'out');
  assert.equal(n.texto, 'hola');
});

test('mensaje de /messages: self=0 → in; imagen → esMedia', () => {
  const n = normalizarMensaje({ id: 'w2', type: 'chat', body: 'que bien', self: 0, fromMe: 0, time: 1779290079, chatId: '57300@c.us', senderName: 'Eduardo' });
  assert.equal(n.direccion, 'in');
  const img = normalizarMensaje({ id: 'w3', type: 'image', body: 'https://s3/x.jpg', caption: 'pie', self: 0, time: 1779290079, chatId: '57300@c.us' });
  assert.equal(img.esMedia, true);
  assert.equal(img.mediaUrl, 'https://s3/x.jpg');
  assert.equal(img.texto, 'pie');
});
```

- [ ] **Step 2: Correr → FAIL** (`<env dummy> node --test test/onemsg-historial.test.js test/normalizador-historial.test.js`).
`<env dummy>` = `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn`

- [ ] **Step 3: Implementar `src/integrations/onemsg/historial.js`**

```js
'use strict';

const axios = require('axios');
const env = require('../../config/env');
const { retryWithBackoff } = require('../../utils/reintentos');
const { OneMsgError } = require('../../utils/errors');

function construirUrl(chatId, lastMessageNumber, limit) {
  const qs = new URLSearchParams({
    token: env.onemsg.token,
    chatId,
    lastMessageNumber: String(lastMessageNumber),
    limit: String(limit),
  });
  return `${env.onemsg.baseUrl}/${env.onemsg.instanceId}/messages?${qs.toString()}`;
}

function codigoDe(data) {
  const c = data && (data.error?.code ?? data.error?.error_code ?? data.code);
  return c != null ? String(c) : null;
}

/**
 * Una página del historial de un chat (GET /messages). `lastMessageNumber=0` da
 * los más viejos; se avanza con el mayor messageNumber de la página. Reintenta 429.
 * @returns {Promise<Array>} mensajes crudos de 1msg.
 */
async function paginaHistorial({ chatId, lastMessageNumber = 0, limit = 100 }, deps = {}) {
  const http = deps.http || axios;
  const baseMs = deps.baseMs || 800;

  const resp = await retryWithBackoff(
    async () => {
      const r = await http.get(construirUrl(chatId, lastMessageNumber, limit), {
        timeout: 30000,
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
  if (resp.status >= 400) {
    throw new OneMsgError(data.message || `historial: 1msg respondió ${resp.status}`, { codigo: codigoDe(data) || String(resp.status) });
  }
  return Array.isArray(data.messages) ? data.messages : [];
}

module.exports = { paginaHistorial };
```

- [ ] **Step 4: Correr → PASS.** Verificar que el normalizador ya pasa (sin cambios).

- [ ] **Step 5: Commit**

```bash
git add src/integrations/onemsg/historial.js test/onemsg-historial.test.js test/normalizador-historial.test.js
git commit -m "feat(historial): cliente onemsg paginaHistorial (GET /messages por cursor) + verifica normalizador"
```

---

### Task 2: Servicio de backfill + migración + campo del modelo

**Files:**
- Create: `src/services/backfill.js`
- Create: `docs/migraciones/002-historial-recuperado.sql`
- Modify: `src/models/conversacion.js`
- Test: `test/backfill.test.js`

**Interfaces:**
- Produces: `recuperarHistorial(conv, deps?): Promise<{ yaRecuperado?: true, recuperados?: number, mediaOk?: number, mediaFallida?: number }>` — `conv` es una instancia de `Conversacion` con `conv.contacto` (waId) cargado y `conv.update` disponible.
- Consumes: `paginaHistorial` (onemsg), `normalizarMensaje` (normalizador), `guardarMediaDeMensaje` (services/media), `Mensaje` (modelo). Todos inyectables por `deps` para test.

- [ ] **Step 1: Migración y modelo**

`docs/migraciones/002-historial-recuperado.sql`:

```sql
-- Marca de que ya se recuperó el historial completo del chat desde 1msg (una vez).
ALTER TABLE wa_conversaciones ADD COLUMN historial_recuperado_en DATETIME NULL;
```

En `src/models/conversacion.js`, junto a `tomadaEn`:

```js
      historialRecuperadoEn: { type: DataTypes.DATE, allowNull: true },
```

- [ ] **Step 2: Test de la lógica de paginación/idempotencia (deps inyectadas)**

`test/backfill.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recuperarHistorial } = require('../src/services/backfill');

function convFalsa() {
  return {
    id: 7,
    contacto: { waId: '57300@c.us' },
    historialRecuperadoEn: null,
    async update(campos) { Object.assign(this, campos); },
  };
}

// Mensaje falso: findOrCreate crea si no existe (por waMessageId).
function mensajeFalso() {
  const almacen = new Map();
  let seq = 100;
  return {
    almacen,
    async findOrCreate({ where, defaults }) {
      const k = where.waMessageId;
      if (almacen.has(k)) return [almacen.get(k), false];
      const inst = { id: (seq += 1), ...defaults, async update() {} };
      almacen.set(k, inst);
      return [inst, true];
    },
    async update() {},
  };
}

test('recupera todas las páginas hasta agotar y no duplica', async () => {
  // 2 páginas de 2 + una página final de 1 (< limit) → total 5 mensajes distintos.
  const paginas = [
    [{ id: 'm1', messageNumber: 10, type: 'chat', body: 'a', self: 0, time: 1 }, { id: 'm2', messageNumber: 11, type: 'chat', body: 'b', self: 1, time: 2 }],
    [{ id: 'm3', messageNumber: 12, type: 'chat', body: 'c', self: 0, time: 3 }, { id: 'm4', messageNumber: 13, type: 'chat', body: 'd', self: 0, time: 4 }],
    [{ id: 'm5', messageNumber: 14, type: 'chat', body: 'e', self: 0, time: 5 }],
  ];
  let i = 0;
  const deps = {
    limit: 2,
    paginaHistorial: async ({ lastMessageNumber }) => (i < paginas.length ? paginas[i++] : []),
    Mensaje: mensajeFalso(),
    guardarMediaDeMensaje: async () => null,
  };
  const conv = convFalsa();
  const r = await recuperarHistorial(conv, deps);
  assert.equal(r.recuperados, 5);
  assert.ok(conv.historialRecuperadoEn instanceof Date);
});

test('si ya está recuperado, no llama a 1msg', async () => {
  const conv = convFalsa();
  conv.historialRecuperadoEn = new Date();
  let llamado = false;
  const r = await recuperarHistorial(conv, { paginaHistorial: async () => { llamado = true; return []; }, Mensaje: mensajeFalso() });
  assert.equal(r.yaRecuperado, true);
  assert.equal(llamado, false);
});
```

- [ ] **Step 3: Correr → FAIL.**

- [ ] **Step 4: Implementar `src/services/backfill.js`**

```js
'use strict';

const { paginaHistorial: paginaHistorialReal } = require('../integrations/onemsg/historial');
const { normalizarMensaje } = require('./normalizador');
const { guardarMediaDeMensaje: guardarMediaReal } = require('./media');
const { Mensaje: MensajeReal } = require('../models');
const { DIRECCION, ESTADO_MENSAJE } = require('../config/constants');
const logger = require('../utils/logger');

const LIMIT_DEFECTO = 100;
const MAX_PAGINAS = 500; // tope de seguridad: 500 * 100 = 50k mensajes
const CONCURRENCIA_MEDIA = 4;

async function enTandas(items, tam, fn) {
  for (let i = 0; i < items.length; i += tam) {
    await Promise.all(items.slice(i, i + tam).map(fn));
  }
}

/**
 * Recupera TODO el historial de un chat desde 1msg y lo guarda idempotente.
 * Corre una vez por conversación (marca historialRecuperadoEn).
 */
async function recuperarHistorial(conv, deps = {}) {
  if (conv.historialRecuperadoEn) return { yaRecuperado: true };

  const paginar = deps.paginaHistorial || paginaHistorialReal;
  const guardarMedia = deps.guardarMediaDeMensaje || guardarMediaReal;
  const Mensaje = deps.Mensaje || MensajeReal;
  const limit = deps.limit || LIMIT_DEFECTO;
  const chatId = conv.contacto.waId;

  let cursor = 0;
  let paginas = 0;
  let recuperados = 0;
  const tareasMedia = [];

  while (paginas < MAX_PAGINAS) {
    const pagina = await paginar({ chatId, lastMessageNumber: cursor, limit });
    if (!pagina.length) break;

    for (const m of pagina) {
      const norm = normalizarMensaje(m);
      if (!norm.waMessageId) continue;
      const [inst, creado] = await Mensaje.findOrCreate({
        where: { waMessageId: norm.waMessageId },
        defaults: {
          conversacionId: conv.id,
          waMessageId: norm.waMessageId,
          direccion: norm.direccion,
          tipo: norm.tipo,
          texto: norm.texto,
          // Mensaje histórico: se asume entregado (no tenemos su ack).
          estado: norm.direccion === DIRECCION.OUT ? ESTADO_MENSAJE.ENTREGADO : ESTADO_MENSAJE.PENDIENTE,
          tsProveedor: norm.tsProveedor,
        },
      });
      if (creado) {
        recuperados += 1;
        if (norm.esMedia && norm.mediaUrl && !inst.mediaRuta) {
          tareasMedia.push({ mensajeId: inst.id, mediaUrl: norm.mediaUrl, conversacionId: conv.id, waMessageId: norm.waMessageId, fecha: norm.tsProveedor });
        }
      }
    }

    cursor = Math.max(...pagina.map((x) => x.messageNumber || 0));
    paginas += 1;
    if (pagina.length < limit) break;
  }
  if (paginas >= MAX_PAGINAS) logger.warn(`backfill conv ${conv.id}: alcanzó el tope de ${MAX_PAGINAS} páginas`);

  let mediaOk = 0;
  let mediaFallida = 0;
  await enTandas(tareasMedia, CONCURRENCIA_MEDIA, async (t) => {
    try {
      const campos = await guardarMedia(t);
      if (campos) { await Mensaje.update(campos, { where: { id: t.mensajeId } }); mediaOk += 1; }
      else mediaFallida += 1;
    } catch (e) {
      mediaFallida += 1;
      logger.error(`backfill media msg ${t.mensajeId}: ${e.message}`);
    }
  });

  await conv.update({ historialRecuperadoEn: new Date() });
  return { recuperados, mediaOk, mediaFallida };
}

module.exports = { recuperarHistorial };
```

- [ ] **Step 5: Correr → PASS** y suite completa verde.

- [ ] **Step 6: Commit**

```bash
git add src/services/backfill.js docs/migraciones/002-historial-recuperado.sql src/models/conversacion.js test/backfill.test.js
git commit -m "feat(historial): servicio de backfill (pagina, upsert idempotente, descarga media) + migración"
```

---

### Task 3: Endpoint de historial + cursor keyset en `mensajes`

**Files:**
- Modify: `src/controllers/conversacionesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- `POST /api/conversaciones/:id/historial` → `{ yaRecuperado }` (200) o `{ recuperados, mediaOk, mediaFallida }` (200); 403; 404; 502 (1msg).
- `GET /api/conversaciones/:id/mensajes?antesDeTs={iso}&antesDeId={n}` → 30 mensajes ascendentes anteriores al cursor `(ts, id)`.

- [ ] **Step 1: Cambiar el cursor de `mensajes` a keyset `(ts_proveedor, id)`**

En `src/controllers/conversacionesController.js`, reemplazar el bloque de `antesDe` del handler `mensajes` por:

```js
    const where = { conversacionId: conv.id };
    const { antesDeTs, antesDeId } = req.query;
    if (antesDeTs !== undefined && antesDeId !== undefined) {
      const ts = new Date(antesDeTs);
      const id = Number(antesDeId);
      if (Number.isNaN(ts.getTime()) || !Number.isInteger(id)) {
        return res.status(400).json({ error: 'cursor inválido' });
      }
      where[Op.or] = [
        { tsProveedor: { [Op.lt]: ts } },
        { tsProveedor: ts, id: { [Op.lt]: id } },
      ];
    }
    const filas = await Mensaje.findAll({ where, order: [['tsProveedor', 'DESC'], ['id', 'DESC']], limit: 30 });
    return res.json({ mensajes: filas.reverse() });
```

(Se elimina el antiguo cursor por `antesDe` (id). `Op` ya está importado en el archivo.)

- [ ] **Step 2: Handler `historial`**

Importar `const { recuperarHistorial } = require('../services/backfill');` (y `Contacto` ya está importado; `OneMsgError` de `../utils/errors` si no está). Añadir:

```js
async function historial(req, res) {
  try {
    const conv = await Conversacion.findByPk(req.params.id, {
      include: [{ model: Contacto, as: 'contacto', attributes: ['id', 'waId'] }],
    });
    if (!conv) return res.status(404).json({ error: 'no encontrada' });
    if (!puedeVer(req.agente, conv)) return res.status(403).json({ error: 'sin acceso' });
    if (!conv.contacto) return res.status(404).json({ error: 'sin contacto' });

    const r = await recuperarHistorial(conv);
    return res.json(r);
  } catch (err) {
    if (err.name === 'OneMsgError') {
      logger.error(`historial 1msg (conv ${req.params.id}): ${err.message} [${err.codigo || ''}]`);
      return res.status(502).json({ error: 'no se pudo recuperar el historial', codigo: err.codigo || null });
    }
    logger.error(`historial conversación ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Exportar `historial` en `module.exports`.

- [ ] **Step 3: Ruta**

En `src/routes/api.js`, junto a las de conversaciones:

```js
router.post('/conversaciones/:id/historial', requireAuth, convCtrl.historial);
```

- [ ] **Step 4: Verificar carga + suite**

```
<env dummy> node -e "require('./src/routes'); console.log('rutas OK')"
<env dummy> node --test test/*.test.js
```
Expected: "rutas OK" y suite verde.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/conversacionesController.js src/routes/api.js
git commit -m "feat(historial): endpoint POST /conversaciones/:id/historial + cursor keyset (ts,id) en mensajes"
```

---

### Task 4: Frontend — disparo al abrir + scroll hacia atrás

**Files:**
- Modify: `frontend/src/stores/chat.js`
- Modify: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Store: estado `recuperando`, `hayMas`, `cargandoMas`; acciones `recuperarHistorial(id)`, `cargarMas()`.

- [ ] **Step 1: Store `chat.js`**

Añadir a `state`: `recuperando: false, hayMas: false, cargandoMas: false`.

En `abrir`, tras setear `this.mensajes = r.mensajes;` y antes/junto al `leer`, fijar `hayMas` y disparar el backfill (sin await bloqueante):

```js
        this.mensajes = r.mensajes;
        this.hayMas = r.mensajes.length === 30;
        await apiFetch(`/conversaciones/${id}/leer`, { method: 'POST' });
        if (!sigueActual()) return;
        this.marcarLeidaEnLista(id);
        this.recuperarHistorial(id); // en segundo plano
```

Añadir las acciones:

```js
    async recuperarHistorial(id) {
      this.recuperando = true;
      try {
        const r = await apiFetch(`/conversaciones/${id}/historial`, { method: 'POST' });
        if (this.conversacion?.id !== id) return;
        if (r.recuperados > 0) {
          const rm = await apiFetch(`/conversaciones/${id}/mensajes`);
          if (this.conversacion?.id === id) {
            this.mensajes = rm.mensajes;
            this.hayMas = rm.mensajes.length === 30;
          }
        }
      } catch {
        /* el historial es best-effort: si falla, se conserva lo local */
      } finally {
        if (this.conversacion?.id === id) this.recuperando = false;
      }
    },
    async cargarMas() {
      if (!this.conversacion || !this.hayMas || this.cargandoMas) return;
      const id = this.conversacion.id;
      const primero = this.mensajes[0];
      if (!primero) return;
      this.cargandoMas = true;
      try {
        const qs = `antesDeTs=${encodeURIComponent(primero.tsProveedor)}&antesDeId=${primero.id}`;
        const r = await apiFetch(`/conversaciones/${id}/mensajes?${qs}`);
        if (this.conversacion?.id !== id) return;
        if (r.mensajes.length < 30) this.hayMas = false;
        if (r.mensajes.length) this.mensajes = [...r.mensajes, ...this.mensajes];
      } finally {
        if (this.conversacion?.id === id) this.cargandoMas = false;
      }
    },
```

(En `cerrar`, resetear también: `this.hayMas = false; this.recuperando = false;`.)

- [ ] **Step 2: `VistaChat.vue` — scroll hacia arriba + indicador**

En `<script setup>` añadir el manejador de scroll (preserva posición al anteponer):

```js
async function onScroll() {
  const el = contenedor.value;
  if (!el || el.scrollTop > 60 || chat.cargandoMas || !chat.hayMas) return;
  const prevH = el.scrollHeight;
  await chat.cargarMas();
  await nextTick();
  if (contenedor.value) contenedor.value.scrollTop = contenedor.value.scrollHeight - prevH;
}
```

Importante: el `watch(() => chat.mensajes, alFondo, { deep: true })` existente hace scroll al fondo en cada cambio de `mensajes`, lo que romper­ía el "cargar más" (que antepone). Cambiar ese auto-scroll para que solo baje cuando se **agrega al final** (mensaje nuevo), no cuando se antepone. Reemplazar el watch por uno que compare el último id:

```js
let ultimoId = null;
watch(() => chat.mensajes, (msgs) => {
  const nuevoUltimo = msgs.length ? msgs[msgs.length - 1].id : null;
  if (nuevoUltimo !== ultimoId) { ultimoId = nuevoUltimo; alFondo(); }
}, { deep: true });
```

En el template, añadir `@scroll="onScroll"` al contenedor de mensajes (el `<div ref="contenedor" …>`), y un indicador arriba:

```vue
    <div ref="contenedor" class="flex-1 overflow-auto p-4 flex flex-col gap-1.5" @scroll="onScroll">
      <div v-if="chat.cargandoMas" class="text-center text-[11px] text-gray-400 py-1">Cargando más…</div>
      <div v-if="chat.recuperando" class="text-center text-[11px] text-gray-400 py-1">Recuperando historial…</div>
      <div v-if="chat.cargando" class="text-center text-gray-500 text-sm">Cargando…</div>
      <div v-else-if="chat.error" class="text-center text-red-500 text-sm">{{ chat.error }}</div>
      <BurbujaMensaje v-for="m in chat.mensajes" :key="m.id" :mensaje="m" />
    </div>
```

- [ ] **Step 3: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/chat.js frontend/src/components/VistaChat.vue
git commit -m "feat(frontend): recuperar historial al abrir + scroll hacia atrás (cursor ts,id)"
```

---

### Task 5: Despliegue + migración + prueba real

- [ ] **Step 1: Migración.** En el servidor, aplicar `docs/migraciones/002-historial-recuperado.sql` sobre `serfuweb` (`ALTER TABLE wa_conversaciones ADD COLUMN historial_recuperado_en DATETIME NULL;`). Confirmar la columna.
- [ ] **Step 2: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 3: Prueba real.** Abrir un chat con mensajes **anteriores** a la ingesta: verificar que aparece el historial completo (texto + imágenes), que el indicador "recuperando historial…" aparece y desaparece, que al reabrir NO se vuelve a recuperar (marca puesta), y que al hacer **scroll hacia arriba** se cargan mensajes más viejos manteniendo la posición. Verificar que no se duplican mensajes ya ingeridos.

---

## Notas de cobertura del spec (Plan 10)

Cubre: cliente `paginaHistorial` (cursor por messageNumber), backfill completo idempotente con descarga de media, marca una-vez-por-chat (migración 002), endpoint con permiso, cursor keyset `(ts,id)` para scroll correcto tras backfill, y frontend (disparo al abrir + scroll hacia atrás + indicadores). **Fuera de alcance:** buscador (Plan 11), scroll de la lista de bandeja (Plan 12), auditoría (Plan 16). El backfill corre en el request; mover al worker si algún chat resultara demasiado grande queda para más adelante.
