# Plan 8 — Visor de media entrante (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los agentes vean en el chat las imágenes, audios, videos y documentos que envían los clientes (la descarga a disco ya existe desde Fase 1).

**Architecture:** Un endpoint autenticado `GET /api/mensajes/:id/media` sirve el archivo ya guardado en disco (validando permiso por conversación y blindando la ruta). El frontend, en `BurbujaMensaje.vue`, detecta los mensajes de tipo media, pide el archivo como **blob** con el token en cabecera (nada de token en la URL), y lo pinta según el tipo (imagen con lightbox, audio/video con controles, documento como tarjeta descargable).

**Tech Stack:** Express/Sequelize + `node:test` (backend); Vue 3 `<script setup>` + Vitest, Fetch/Blob API (frontend).

## Global Constraints

- Aislamiento 1msg: este plan NO habla con 1msg (solo sirve archivos locales). No tocar `src/integrations/onemsg/`.
- Permisos: servir un archivo exige `puedeVer(req.agente, conversación del mensaje)`.
- Sin token en URLs de media: el frontend carga el archivo con `fetch` + cabecera `Authorization` (blob), no como `<img src="/api/...?token=">`.
- Blindaje de ruta: la ruta absoluta resuelta debe quedar dentro de `env.media.path`.
- `'use strict'`, CommonJS, nombres de dominio en español / técnicos en inglés, sin `console.log`.
- No cambia el modelo ni la ingesta; sin migraciones. La API de mensajes ya devuelve `tipo` y los campos `media_*`.
- Tiempo real: NO se necesita evento nuevo. El worker emite `mensaje:nuevo` después de la descarga (verificado en `ingesta.js`), así que al llegar el mensaje el archivo ya está en disco; el frontend reintenta una vez ante 404 como red de seguridad.

## File Structure

- `src/services/media.js` (modificar): añadir helper puro `rutaMediaSegura(mediaRuta, base)`.
- `src/controllers/mediaController.js` (crear): handler `servir` que valida permiso y hace `res.sendFile`.
- `src/routes/api.js` (modificar): montar `GET /mensajes/:id/media`.
- `frontend/src/api/cliente.js` (modificar): añadir `fetchMediaBlob(ruta)`.
- `frontend/src/utils/formato.js` (modificar): añadir `tamanoLegible(bytes)`.
- `frontend/src/components/BurbujaMensaje.vue` (modificar): render por tipo con carga de blob y lightbox.

---

### Task 1: Backend — endpoint que sirve el archivo

**Files:**
- Modify: `src/services/media.js`
- Create: `src/controllers/mediaController.js`
- Modify: `src/routes/api.js`
- Test: `test/media-servicio.test.js`

**Interfaces:**
- Produces: `rutaMediaSegura(mediaRuta: string, base: string): string|null` — ruta absoluta si queda dentro de `base`, si no `null`. `servir(req, res)` — Express handler; 404 si el mensaje no existe / no tiene `media_ruta` / la ruta es insegura; 403 si `!puedeVer`; si todo bien, hace `res.sendFile`.
- Consumes: `puedeVer(agente, conv)` de `../services/conversaciones`; `Mensaje`, `Conversacion` de `../models` (alias `conversacion`); `env.media.path`.

- [ ] **Step 1: Test del helper puro `rutaMediaSegura`**

Crear `test/media-servicio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { rutaMediaSegura } = require('../src/services/media');

const BASE = '/var/wa/media';

test('rutaMediaSegura: ruta normal → absoluta dentro de base', () => {
  assert.equal(rutaMediaSegura('2026/07/5/wamid.jpg', BASE), path.join(BASE, '2026/07/5/wamid.jpg'));
});

test('rutaMediaSegura: intento de salir con .. → null', () => {
  assert.equal(rutaMediaSegura('../../etc/passwd', BASE), null);
  assert.equal(rutaMediaSegura('2026/../../../secret', BASE), null);
});

test('rutaMediaSegura: vacío → null', () => {
  assert.equal(rutaMediaSegura('', BASE), null);
  assert.equal(rutaMediaSegura(null, BASE), null);
});
```

- [ ] **Step 2: Correr → FAIL**

Run (env dummy):
```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/media-servicio.test.js
```
Expected: FAIL (`rutaMediaSegura is not a function`).

- [ ] **Step 3: Implementar `rutaMediaSegura` en `src/services/media.js`**

`src/services/media.js` ya importa `path`. Añadir antes de `module.exports`:

```js
/**
 * Devuelve la ruta absoluta del archivo si queda dentro de `base`; si no, null.
 * Defensa contra rutas con `..` (media_ruta la generamos nosotros, pero se valida).
 */
function rutaMediaSegura(mediaRuta, base) {
  if (!mediaRuta) return null;
  const baseAbs = path.resolve(base);
  const abs = path.resolve(baseAbs, mediaRuta);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) return null;
  return abs;
}
```

Y cambiar el export:

```js
module.exports = { guardarMediaDeMensaje, rutaMediaSegura };
```

- [ ] **Step 4: Correr → PASS**

Run el mismo comando del Step 2. Expected: PASS (3 tests).

- [ ] **Step 5: Implementar el controlador `src/controllers/mediaController.js`**

```js
'use strict';

const { Mensaje, Conversacion } = require('../models');
const { puedeVer } = require('../services/conversaciones');
const { rutaMediaSegura } = require('../services/media');
const env = require('../config/env');
const logger = require('../utils/logger');

/** GET /api/mensajes/:id/media — sirve el archivo guardado si el agente puede ver la conversación. */
async function servir(req, res) {
  try {
    const msg = await Mensaje.findByPk(req.params.id, {
      include: [{ model: Conversacion, as: 'conversacion' }],
    });
    if (!msg) return res.status(404).json({ error: 'no encontrado' });
    if (!msg.conversacion || !puedeVer(req.agente, msg.conversacion)) {
      return res.status(403).json({ error: 'sin acceso' });
    }
    if (!msg.mediaRuta) return res.status(404).json({ error: 'sin archivo' });

    const abs = rutaMediaSegura(msg.mediaRuta, env.media.path);
    if (!abs) return res.status(404).json({ error: 'sin archivo' });

    const nombre = String(msg.mediaNombre || 'archivo').replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');

    return res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'sin archivo' });
    });
  } catch (err) {
    logger.error(`servir media ${req.params.id}: ${err.message}`);
    if (!res.headersSent) return res.status(500).json({ error: 'error interno' });
    return undefined;
  }
}

module.exports = { servir };
```

(Nota: `res.sendFile` fija el `Content-Type` según la extensión del archivo, que se derivó del mime al descargar, así que coincide. `res.sendFile` también da soporte de Range y caché para audio/video.)

- [ ] **Step 6: Montar la ruta en `src/routes/api.js`**

Añadir el require junto a los otros controladores:

```js
const mediaCtrl = require('../controllers/mediaController');
```

Y la ruta junto a las de conversaciones:

```js
router.get('/mensajes/:id/media', requireAuth, mediaCtrl.servir);
```

- [ ] **Step 7: Verificar carga y suite**

```
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node -e "require('./src/routes'); console.log('rutas OK')"
JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js
```
Expected: "rutas OK" y toda la suite verde.

- [ ] **Step 8: Commit**

```bash
git add src/services/media.js src/controllers/mediaController.js src/routes/api.js test/media-servicio.test.js
git commit -m "feat(media): endpoint GET /mensajes/:id/media (permiso por conversación + ruta blindada)"
```

---

### Task 2: Frontend — render del media en la burbuja

**Files:**
- Modify: `frontend/src/api/cliente.js`
- Modify: `frontend/src/utils/formato.js`
- Modify: `frontend/src/components/BurbujaMensaje.vue`
- Test: `frontend/src/utils/formato.test.js` (existe)

**Interfaces:**
- Produces: `fetchMediaBlob(ruta): Promise<{ blob, url, filename, mime }>` (lanza Error con `.status` si no-ok). `tamanoLegible(bytes): string`.
- Consumes: `tokenGuardado()` de `./cliente`; la API `GET /api/mensajes/:id/media`.

- [ ] **Step 1: Test de `tamanoLegible`**

Añadir a `frontend/src/utils/formato.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { tamanoLegible } from './formato';

describe('tamanoLegible', () => {
  it('formatea bytes a unidad legible', () => {
    expect(tamanoLegible(0)).toBe('');
    expect(tamanoLegible(512)).toBe('512 B');
    expect(tamanoLegible(2048)).toBe('2.0 KB');
    expect(tamanoLegible(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
```

(Si el archivo ya tiene `import { describe, it, expect } from 'vitest';`, no lo dupliques; añade solo el `import { tamanoLegible }` y el bloque `describe`.)

- [ ] **Step 2: Correr → FAIL**

Run: `npm --prefix frontend test`
Expected: FAIL (`tamanoLegible` no exportada).

- [ ] **Step 3: Implementar `tamanoLegible` en `frontend/src/utils/formato.js`**

Añadir al final:

```js
export function tamanoLegible(bytes) {
  if (!bytes || bytes < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
```

- [ ] **Step 4: Correr → PASS**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Añadir `fetchMediaBlob` a `frontend/src/api/cliente.js`**

Añadir (usa `tokenGuardado`, ya definido en el archivo):

```js
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
```

- [ ] **Step 6: Reescribir `frontend/src/components/BurbujaMensaje.vue`**

```vue
<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { horaCorta, iconoEstado, esLeido, etiquetaTipo, tamanoLegible } from '../utils/formato';
import { fetchMediaBlob } from '../api/cliente';

const props = defineProps({ mensaje: { type: Object, required: true } });
const saliente = computed(() => props.mensaje.direccion === 'out');

const TIPOS_MEDIA = ['image', 'sticker', 'audio', 'video', 'document'];
const esMedia = computed(() => TIPOS_MEDIA.includes(props.mensaje.tipo));
const caption = computed(() => props.mensaje.texto || '');

const media = ref(null); // { blob, url, filename, mime }
const estado = ref('idle'); // idle | cargando | listo | error
const ampliada = ref(false);

async function cargar(reintentos = 1) {
  estado.value = 'cargando';
  try {
    media.value = await fetchMediaBlob(`/mensajes/${props.mensaje.id}/media`);
    estado.value = 'listo';
  } catch (e) {
    if (e.status === 404 && reintentos > 0) {
      setTimeout(() => cargar(reintentos - 1), 1500);
      return;
    }
    estado.value = 'error';
  }
}

onMounted(() => { if (esMedia.value) cargar(); });
onUnmounted(() => { if (media.value?.url) URL.revokeObjectURL(media.value.url); });
</script>

<template>
  <div class="flex" :class="saliente ? 'justify-end' : 'justify-start'">
    <div class="max-w-[75%] px-2.5 py-1.5 rounded-lg text-[13.5px] leading-snug shadow-sm"
      :class="saliente ? 'bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'">

      <div v-if="esMedia" class="mb-0.5">
        <div v-if="estado === 'cargando' || estado === 'idle'" class="text-[12px] text-gray-400 py-3 text-center">Cargando…</div>
        <div v-else-if="estado === 'error'" class="text-[12px] text-gray-400 py-3 text-center">📎 Archivo no disponible</div>
        <template v-else>
          <img v-if="mensaje.tipo === 'image' || mensaje.tipo === 'sticker'" :src="media.url"
            class="rounded max-h-64 cursor-pointer" @click="ampliada = true" alt="" />
          <audio v-else-if="mensaje.tipo === 'audio'" :src="media.url" controls class="max-w-full" />
          <video v-else-if="mensaje.tipo === 'video'" :src="media.url" controls class="rounded max-h-64 max-w-full" />
          <a v-else :href="media.url" :download="media.filename || 'archivo'"
            class="flex items-center gap-2 py-1 text-marca-oscuro">
            <span class="text-lg">📄</span>
            <span class="truncate max-w-[180px] underline">{{ media.filename || 'Documento' }}</span>
            <span class="text-[11px] text-gray-500 shrink-0">{{ tamanoLegible(media.blob && media.blob.size) }}</span>
          </a>
        </template>
      </div>

      <span v-if="!esMedia" class="whitespace-pre-wrap break-words">{{ caption || etiquetaTipo(mensaje.tipo) }}</span>
      <span v-else-if="caption" class="whitespace-pre-wrap break-words block">{{ caption }}</span>

      <span class="text-[10px] text-gray-500 float-right ml-2 mt-1.5">
        {{ horaCorta(mensaje.tsProveedor) }}
        <span v-if="saliente" :class="esLeido(mensaje.estado) ? 'text-sky-500' : 'text-gray-500'">{{ iconoEstado(mensaje.estado) }}</span>
      </span>
    </div>

    <div v-if="ampliada" class="fixed inset-0 bg-black/80 grid place-items-center z-50 p-4" @click="ampliada = false">
      <img :src="media.url" class="max-w-full max-h-full rounded" alt="" />
    </div>
  </div>
</template>
```

- [ ] **Step 7: Verificar suite y build del frontend**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: tests verdes y build OK.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/cliente.js frontend/src/utils/formato.js frontend/src/components/BurbujaMensaje.vue frontend/src/utils/formato.test.js
git commit -m "feat(frontend): render de media entrante en la burbuja (imagen/audio/video/documento) por blob autenticado"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1:** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`; `/health` 200 y `GET /api/mensajes/1/media` sin token → 401.
- [ ] **Step 2: Prueba real.** Desde un WhatsApp propio, enviar al número del negocio: (a) una imagen con texto, (b) una nota de voz, (c) un PDF. En la bandeja, abrir ese chat y confirmar que se ven: imagen (clic → grande), audio reproducible, documento descargable con nombre y tamaño; el caption aparece bajo la imagen. Verificar también que un chat de otro agente no permite abrir su media (403 si se llama el endpoint con ese id).

---

## Notas de cobertura del spec (Plan 8)

Cubre: servir media con permiso por conversación + ruta blindada; render por tipo con blob autenticado (sin token en URL); lightbox de imagen; documento descargable; caption bajo el media; red de seguridad de reintento ante 404. Confirmado que no hace falta evento de tiempo real. **Fuera de este plan (Plan 9):** envío de adjuntos (subir + `sendFile`), botón 📎, pegar y arrastrar-soltar.
