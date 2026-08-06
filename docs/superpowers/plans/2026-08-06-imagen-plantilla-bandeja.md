# Mostrar la imagen de plantilla en la bandeja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la burbuja del chat muestre la imagen del encabezado de las plantillas salientes (difusión, recordatorio, envío manual), guardando su URL en el mensaje y pintándola directo — sin descargar el archivo.

**Architecture:** Nueva columna `wa_mensajes.media_url` (la serialización ya devuelve el modelo completo → llega al frontend solo). El backend la llena al enviar plantilla con imagen (vía `persistirEnvioPlantilla` para difusión/recordatorio, y en el handler manual). El frontend pinta `<img :src="mensaje.mediaUrl">`. Se añade `losolivoscucuta.com` al CSP `img-src` (las de difusión son mismo-origen).

**Tech Stack:** Node 20 CommonJS, Sequelize, MySQL; Vue 3 `<script setup>`. Tests: `node:test` (backend), build (frontend).

## Global Constraints

- Solo tablas `wa_`. La URL es de imágenes públicas que ya se envían al cliente (sin token/dato sensible).
- No cambia el envío a 1msg ni el `tipo='template'` del mensaje; solo se le suma `media_url`.
- Backend test command:
  `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>`

## File Structure

- `docs/migraciones/009-mensaje-media-url.sql` (crear); `src/models/Mensaje.js`, `docs/esquema_bandeja.sql` (modificar).
- `src/app.js` (modificar) — CSP img-src.
- `src/services/envioPlantilla.js` (modificar) — `mediaUrl` param.
- `src/services/difusionEnvio.js`, `src/services/recordatorios.js`, `src/controllers/conversacionesController.js` (modificar) — pasar/guardar la URL.
- `frontend/src/components/BurbujaMensaje.vue` (modificar) — pintar la imagen.

---

### Task 1: Migración 009 + modelo + CSP

**Files:**
- Create: `docs/migraciones/009-mensaje-media-url.sql`
- Modify: `src/models/Mensaje.js`, `docs/esquema_bandeja.sql`, `src/app.js`
- Test: `test/mensaje-media-url.test.js`

**Interfaces:**
- Produces: `Mensaje.mediaUrl` (STRING(255) NULL); CSP `img-src` incluye `https://losolivoscucuta.com`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/mensaje-media-url.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Mensaje } = require('../src/models');

test('Mensaje tiene mediaUrl', () => {
  assert.ok(Mensaje.rawAttributes.mediaUrl, 'falta mediaUrl');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `... node --test test/mensaje-media-url.test.js`
Expected: FAIL ("falta mediaUrl").

- [ ] **Step 3: Write the migration + model + esquema + CSP**

`docs/migraciones/009-mensaje-media-url.sql`:
```sql
-- URL pública de la imagen de encabezado de una plantilla saliente (para mostrarla en la bandeja).
ALTER TABLE wa_mensajes ADD COLUMN media_url VARCHAR(255) NULL AFTER media_nombre;
```

In `src/models/Mensaje.js`, add the field near the other `media*` fields (e.g. after `mediaNombre`):
```javascript
      mediaUrl: { type: DataTypes.STRING(255), allowNull: true },
```

In `docs/esquema_bandeja.sql`, add `media_url VARCHAR(255) NULL` to the `wa_mensajes` `CREATE TABLE` block, after `media_nombre`.

In `src/app.js`, change the `img-src` line to include the template-image host:
```javascript
          'img-src': ["'self'", 'data:', 'blob:', 'https://cucuta.losolivos.co', 'https://losolivoscucuta.com'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `... node --test test/mensaje-media-url.test.js`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add docs/migraciones/009-mensaje-media-url.sql src/models/Mensaje.js docs/esquema_bandeja.sql src/app.js test/mensaje-media-url.test.js
git commit -m "feat(bandeja): columna media_url en mensajes + CSP img-src losolivoscucuta.com"
```

---

### Task 2: Guardar la URL de la imagen al enviar plantilla

**Files:**
- Modify: `src/services/envioPlantilla.js`, `src/services/difusionEnvio.js`, `src/services/recordatorios.js`, `src/controllers/conversacionesController.js`

**Interfaces:**
- Consumes: `Mensaje.mediaUrl` (Task 1).
- Produces: `persistirEnvioPlantilla({ ..., mediaUrl })` guarda `mediaUrl` en el mensaje.

- [ ] **Step 1: Add `mediaUrl` to the shared helper**

In `src/services/envioPlantilla.js`, add `mediaUrl` to the destructured params of `persistirEnvioPlantilla`, and to the `Mensaje.findOrCreate` `defaults`:
```javascript
async function persistirEnvioPlantilla({ contactoId, agenteFallback, canalId, plantillaNombre, texto, waMessageId, origen, mediaUrl }, extra) {
```
and in the message `defaults` object add:
```javascript
        mediaUrl: mediaUrl || null,
```
(Leave the rest unchanged.)

- [ ] **Step 2: Pass the URL from difusiones**

In `src/services/difusionEnvio.js`, in the success path where it calls `persistirEnvioPlantilla`, compute and pass the header image URL. Just before the call:
```javascript
  const mediaUrl = def.tieneImagen ? (dif.imagenUrl || def.imagenDefault) : null;
```
and add `mediaUrl,` to the object passed to `persistirEnvioPlantilla`.

- [ ] **Step 3: Pass the URL from recordatorios**

In `src/services/recordatorios.js`, inside `enviarRecordatorio`, just before the `persistirEnvioPlantilla` call, compute:
```javascript
  const mediaUrl = def.tieneImagen ? (aj.recordatorio_imagen_url || def.imagenDefault) : null;
```
and add `mediaUrl,` to the object passed to `persistirEnvioPlantilla`.

- [ ] **Step 4: Store the URL on the manual plantilla send**

In `src/controllers/conversacionesController.js`, in `enviarPlantilla`, the outbound `Mensaje.findOrCreate` `defaults` currently has `plantillaNombre: template, ...`. Add:
```javascript
        mediaUrl: imagenUrl || null,
```
(`imagenUrl` is the header image variable already used to build `construirParamsHeader(imagenUrl)` in that handler.)

- [ ] **Step 5: Run tests**

Run the full backend suite (the persist/handlers are verified live; nothing should regress):
`... node --test test/*.test.js`
Expected: PASS (was 165). `test/difusion-envio.test.js` (`payloadDeEnvio`) unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/services/envioPlantilla.js src/services/difusionEnvio.js src/services/recordatorios.js src/controllers/conversacionesController.js
git commit -m "feat(bandeja): guardar la URL de la imagen del encabezado al enviar plantilla"
```

---

### Task 3: Pintar la imagen en la burbuja

**Files:**
- Modify: `frontend/src/components/BurbujaMensaje.vue`

**Interfaces:**
- Consumes: `mensaje.mediaUrl`.

- [ ] **Step 1: Add the header-image render**

In `frontend/src/components/BurbujaMensaje.vue` `<script setup>`, add after the `caption` computed:
```javascript
// Imagen de encabezado de plantilla (difusión/recordatorio/manual): URL pública, se
// pinta directo (no pasa por fetchMediaBlob). Independiente de `esMedia`.
const urlEncabezado = computed(() => props.mensaje.mediaUrl || null);
```
Add a state flag for a graceful fallback if the image fails to load:
```javascript
const encabezadoRoto = ref(false);
```
(`ref` is already imported.)

Change the enlarge/download modal to use the header URL when there's no blob. Add a computed:
```javascript
const urlAmpliada = computed(() => (media.value && media.value.url) || urlEncabezado.value);
```

- [ ] **Step 2: Render it in the template**

In the template, add the header image block **before** the `esMedia` block (i.e. before `<div v-if="esMedia" ...>`):
```html
      <div v-if="urlEncabezado && !encabezadoRoto" class="mb-0.5">
        <img :src="urlEncabezado" class="rounded max-h-64 cursor-pointer" alt=""
          @click="ampliada = true" @error="encabezadoRoto = true" />
      </div>
```
In the ampliada modal, replace the two `:src="media.url"` / `:href="media.url"` usages with `urlAmpliada`:
- the download `<a :href="media.url" ...>` → `:href="urlAmpliada"`
- the enlarge `<img :src="media.url" ...>` → `:src="urlAmpliada"`

(This keeps the existing media behavior — for real media, `urlAmpliada` is the blob URL — and adds the template-image case.)

Note: the existing text span (`contenidoTexto`) already renders below for non-media messages, so the plantilla text shows as the caption under the image. No change needed there.

- [ ] **Step 3: Verify build**

Run: `npm --prefix frontend run build`
Expected: build limpio.
Run: `npm --prefix frontend test`
Expected: PASS (los previos; no se agregan tests de componente, consistente con el repo).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BurbujaMensaje.vue
git commit -m "feat(bandeja): mostrar la imagen del encabezado de plantilla en la burbuja"
```

---

## Verificación en vivo (tras completar)

Deploy: migración 009 en el server, `git pull`, `npm --prefix frontend run build`, reiniciar `wa-backend` y `wa-worker`.
1. Enviar una difusión de prueba (o un envío manual de plantilla con imagen) a un número de prueba → abrir ese chat en la bandeja → confirmar que **se ve la imagen** + el texto debajo.
2. Un recordatorio (o el ya enviado, si se re-renderiza) también debe mostrar la imagen.
3. Verificar que los mensajes **de media normales** (imágenes entrantes/adjuntos) siguen viéndose igual (no se rompió `fetchMediaBlob`).
4. Consola del navegador sin errores de CSP para `losolivoscucuta.com`.

## Notas

- Los mensajes de plantilla **ya enviados** antes de este cambio tienen `media_url` NULL → seguirán mostrando solo texto (no reprocesamos históricos). Los nuevos sí traen la imagen.
- Si una URL apunta a un host fuera del CSP, la imagen no carga y `@error` deja solo el texto (sin romper la burbuja).
