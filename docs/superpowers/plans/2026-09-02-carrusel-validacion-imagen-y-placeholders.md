# Carrusel: validación de imagen + placeholders — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validar que las imágenes subidas al carrusel sean JPEG/PNG reales (≤5 MB, mismo aspecto entre tarjetas) y mostrar los valores de ejemplo de la plantilla como placeholder de cada variable en el wizard.

**Architecture:** Un helper puro `leerImagen(buffer)` inspecciona los bytes mágicos y extrae dimensiones (sin dependencias); `guardarImagen` lo usa para rechazar formatos no válidos y guardar ancho/alto por tarjeta. `carruselListo` valida que todas las tarjetas compartan relación de aspecto. `parsearPlantilla` expone los `example.body_text` por variable y el wizard los usa como placeholder.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize (JSON), Vue 3 + Pinia, `node:test`, Vitest.

Spec: `docs/superpowers/specs/2026-09-02-carrusel-validacion-imagen-y-placeholders-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. Solo `src/integrations/onemsg/` habla con 1msg (aquí no se toca el envío).
- **Validación por bytes reales, nunca por el mime declarado** (fue la causa del bug de la difusión 36).
- Formatos aceptados: **solo JPEG (`FF D8 FF`) y PNG (`89 50 4E 47 0D 0A 1A 0A`)**; tamaño ≤ **5 MB** (`5 * 1024 * 1024`).
- Sin dependencias nuevas (dimensiones leídas parseando el encabezado). Nombres de archivo deterministas y sin traversal (guard existente intacto).
- Regresión cero: plantillas planas y difusiones existentes siguen igual; el chequeo de aspecto se **omite** si a alguna tarjeta le faltan `ancho`/`alto`.
- Tolerancia de aspecto: `|ratio_i - ratio_0| / ratio_0 ≤ 0.02`.
- Placeholders: **solo en el carrusel**.
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (suite completa: `test/*.test.js`; este Node usa el reporter con `ℹ`, lee la línea final `fail N`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/difusionImagen.js` | `leerImagen` (bytes+dims), `guardarImagen` valida y devuelve dims, `nombreArchivoImagen` por formato | Modificar |
| `test/difusion-imagen.test.js` | tests de `leerImagen` + `nombreArchivoImagen` | Modificar |
| `src/controllers/difusionesController.js` | subidas usan la firma nueva; carrusel guarda `ancho`/`alto` | Modificar |
| `src/services/difusiones.js` | `carruselListo` valida relación de aspecto | Modificar |
| `test/difusion-servicio.test.js` | tests de aspecto | Modificar |
| `src/services/plantillas.js` | `parsearTarjeta`/`parsearPlantilla` exponen ejemplos | Modificar |
| `test/plantillas-servicio.test.js` | tests de ejemplos | Modificar |
| `frontend/src/components/DifusionWizard.vue` | placeholders con ejemplos + `accept` JPEG/PNG | Modificar |

---

## Task 1: Validación real de imagen (`leerImagen`) + `guardarImagen`/`nombreArchivoImagen`

**Files:**
- Modify: `src/services/difusionImagen.js`
- Test: `test/difusion-imagen.test.js`
- Modify: `src/controllers/difusionesController.js`

**Interfaces:**
- Produces: `leerImagen(buffer) → { formato: 'jpg'|'png', ancho: number, alto: number }` o lanza `err400`.
- Produces: `nombreArchivoImagen(difusionId, formato, cardIndex?)` — `formato` es `'jpg'`/`'png'` (ya no un mime); nombre `dif-{id}[-c{idx}].{formato}`.
- Produces: `guardarImagen(difusionId, buffer, cardIndex?) → { rutaRelativa, url, ancho, alto }` (ya no recibe `mime`; valida el buffer con `leerImagen`).
- Consumers actualizados: `subirImagenCarrusel` y `subirImagen` en el controller.

- [ ] **Step 1: Reescribir el test que falla**

Replace the contents of `test/difusion-imagen.test.js` with (mantiene el patrón `node:test` del repo):

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { leerImagen, nombreArchivoImagen } = require('../src/services/difusionImagen');

function pngBuf(w, h) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  Buffer.from('IHDR').copy(b, 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function jpegBuf(w, h) {
  const b = Buffer.alloc(24);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0;
  b.writeUInt16BE(0x0011, 4); // largo del segmento
  b[6] = 0x08; // precisión
  b.writeUInt16BE(h, 7);
  b.writeUInt16BE(w, 9);
  return b;
}
function webpBuf() {
  const b = Buffer.alloc(24);
  Buffer.from('RIFF').copy(b, 0);
  Buffer.from('WEBP').copy(b, 8);
  return b;
}

test('leerImagen: PNG → formato png con dimensiones', () => {
  assert.deepEqual(leerImagen(pngBuf(900, 1600)), { formato: 'png', ancho: 900, alto: 1600 });
});
test('leerImagen: JPEG → formato jpg con dimensiones', () => {
  assert.deepEqual(leerImagen(jpegBuf(461, 571)), { formato: 'jpg', ancho: 461, alto: 571 });
});
test('leerImagen: WebP (disfrazado) → rechazado', () => {
  assert.throws(() => leerImagen(webpBuf()), /JPEG o PNG|no soportado/);
});
test('leerImagen: basura → rechazada', () => {
  assert.throws(() => leerImagen(Buffer.alloc(24)));
});
test('leerImagen: buffer diminuto → rechazado', () => {
  assert.throws(() => leerImagen(Buffer.alloc(8)));
});
test('leerImagen: > 5 MB → rechazado', () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  assert.throws(() => leerImagen(big), /5 MB/);
});
test('nombreArchivoImagen: por formato, con y sin índice de tarjeta', () => {
  assert.equal(nombreArchivoImagen(15, 'jpg', 0), 'dif-15-c0.jpg');
  assert.equal(nombreArchivoImagen(15, 'png', 2), 'dif-15-c2.png');
  assert.equal(nombreArchivoImagen(15, 'jpg'), 'dif-15.jpg');
  assert.throws(() => nombreArchivoImagen(15, 'webp'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-imagen.test.js`
Expected: FAIL (`leerImagen` no existe; `nombreArchivoImagen` aún espera mime).

- [ ] **Step 3: Implementar en `difusionImagen.js`**

Replace `src/services/difusionImagen.js` with:

```js
'use strict';
const fs = require('fs/promises');
const path = require('path');
const env = require('../config/env');

const SUBDIR = 'difusiones';
const MAX_BYTES = 5 * 1024 * 1024; // límite de WhatsApp para imagen de encabezado

function err400(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Dimensiones de un JPEG recorriendo hasta un marcador SOF. null si no se hallan. */
function dimensionesJpeg(buf) {
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Valida por bytes reales que sea JPEG/PNG ≤5 MB y devuelve { formato, ancho, alto }. */
function leerImagen(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) throw err400('imagen ilegible o corrupta');
  if (buffer.length > MAX_BYTES) throw err400('la imagen supera 5 MB');
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const ancho = buffer.readUInt32BE(16);
    const alto = buffer.readUInt32BE(20);
    if (!ancho || !alto) throw err400('imagen ilegible o corrupta');
    return { formato: 'png', ancho, alto };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const dim = dimensionesJpeg(buffer);
    if (!dim || !dim.ancho || !dim.alto) throw err400('imagen ilegible o corrupta');
    return { formato: 'jpg', ancho: dim.ancho, alto: dim.alto };
  }
  throw err400('formato no soportado: usa JPEG o PNG');
}

/** Nombre determinístico por campaña (y por tarjeta si se da cardIndex). */
function nombreArchivoImagen(difusionId, formato, cardIndex) {
  if (!['jpg', 'png'].includes(formato)) throw err400('formato no soportado: usa JPEG o PNG');
  const sufijo = cardIndex === undefined || cardIndex === null ? '' : `-c${Number(cardIndex)}`;
  return `dif-${difusionId}${sufijo}.${formato}`;
}

/** Ruta absoluta segura del archivo servible; rechaza traversal. */
function rutaAbsolutaImagen(nombre) {
  if (/[\\/]/.test(String(nombre)) || String(nombre).includes('..')) throw err400('nombre inválido');
  return path.join(env.media.path, SUBDIR, String(nombre));
}

/** Valida el buffer, guarda la imagen y devuelve URL pública + dimensiones. */
async function guardarImagen(difusionId, buffer, cardIndex) {
  const { formato, ancho, alto } = leerImagen(buffer);
  const nombre = nombreArchivoImagen(difusionId, formato, cardIndex);
  const abs = rutaAbsolutaImagen(nombre);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  const base = (env.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { rutaRelativa: path.join(SUBDIR, nombre), url: `${base}/media-difusion/${nombre}`, ancho, alto };
}

module.exports = { leerImagen, nombreArchivoImagen, rutaAbsolutaImagen, guardarImagen };
```

- [ ] **Step 4: Actualizar los llamadores en `difusionesController.js`**

In `src/controllers/difusionesController.js`, `subirImagen` (imagen única) — quitar el `mime`:

```js
    const { url } = await guardarImagen(req.params.id, req.file.buffer);
```

In `subirImagenCarrusel` — quitar el `mime` y guardar `ancho`/`alto` en la tarjeta:

```js
    const { url, ancho, alto } = await guardarImagen(req.params.id, req.file.buffer, idx);
    // Sequelize no detecta mutación in-place de un campo JSON: se asigna un objeto nuevo.
    const carrusel = { ...dif.carrusel, cards: dif.carrusel.cards.map((c, i) => (i === idx ? { ...c, imagenUrl: url, ancho, alto } : c)) };
    await dif.update({ carrusel });
```

- [ ] **Step 5: Correr el test del módulo y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-imagen.test.js`
Expected: PASS (7/7).

- [ ] **Step 6: `node --check` + suite completa (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/difusionImagen.js && node --check src/controllers/difusionesController.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`. (Si algún otro archivo importaba `EXT_POR_MIME`, saldrá aquí — ya no se exporta; corrige ese import o elimínalo.)

- [ ] **Step 7: Commit**

```bash
git add src/services/difusionImagen.js test/difusion-imagen.test.js src/controllers/difusionesController.js
git commit -m "feat(carrusel): validar imagen por bytes reales (JPEG/PNG, ≤5MB) y guardar dimensiones"
```

---

## Task 2: `carruselListo` valida la relación de aspecto

**Files:**
- Modify: `src/services/difusiones.js`
- Test: `test/difusion-servicio.test.js`

**Interfaces:**
- Consumes: `dif.carrusel.cards[i].ancho`/`.alto` (guardados en Task 1).
- Produces: `carruselListo(dif, def)` añade el chequeo de aspecto; firma y demás comportamiento sin cambios.

- [ ] **Step 1: Escribir los tests que fallan**

In `test/difusion-servicio.test.js`, add:

```js
test('carruselListo: distinta relación de aspecto → no ok', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'], ancho: 1600, alto: 900 },
  ] } };
  assert.equal(carruselListo(dif, def).ok, false);
});

test('carruselListo: misma relación de aspecto → ok', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'], ancho: 450, alto: 800 },
  ] } };
  assert.equal(carruselListo(dif, def).ok, true);
});

test('carruselListo: falta ancho/alto en una tarjeta → omite el chequeo de aspecto (ok)', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 1, tieneImagen: true }, { variables: 1, tieneImagen: true }] } };
  const dif = { carrusel: { bodyVars: ['x'], cards: [
    { imagenUrl: 'a', vars: ['a'], ancho: 900, alto: 1600 },
    { imagenUrl: 'b', vars: ['b'] },
  ] } };
  assert.equal(carruselListo(dif, def).ok, true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-servicio.test.js`
Expected: FAIL (el primer test espera `ok:false` pero aún no hay chequeo de aspecto).

- [ ] **Step 3: Implementar el chequeo en `carruselListo`**

In `src/services/difusiones.js`, in `carruselListo`, right before the final `return { ok: true };`, add:

```js
  // Todas las tarjetas con imagen deben compartir la relación de aspecto (si hay dimensiones).
  const conDims = c.cards.filter((card) => card && card.ancho && card.alto);
  if (conDims.length === c.cards.length && conDims.length > 1) {
    const r0 = conDims[0].ancho / conDims[0].alto;
    const dispar = conDims.some((card) => Math.abs(card.ancho / card.alto - r0) / r0 > 0.02);
    if (dispar) return { ok: false, motivo: 'las tarjetas deben tener la misma relación de aspecto' };
  }
```

- [ ] **Step 4: Correr y verificar que pasa (+ sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/difusiones.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/difusiones.js test/difusion-servicio.test.js
git commit -m "feat(carrusel): iniciar valida que las tarjetas compartan relación de aspecto"
```

---

## Task 3: `parsearTarjeta`/`parsearPlantilla` exponen los ejemplos

**Files:**
- Modify: `src/services/plantillas.js`
- Test: `test/plantillas-servicio.test.js`

**Interfaces:**
- Produces: `parsearTarjeta(card)` añade `ejemplos: string[]` (de `card.BODY.example.body_text[0]`).
- Produces: `parsearPlantilla(...).carrusel` añade `bodyEjemplos: string[]` (de `BODY.example.body_text[0]`); cada `carrusel.cards[i].ejemplos`.

- [ ] **Step 1: Escribir el test que falla**

In `test/plantillas-servicio.test.js`, extend the existing `plantillaCarrusel` fixture so the top BODY and each card BODY carry `example.body_text`, then assert. Add a BODY example to the fixture's top body and to each card (si el fixture ya define esos componentes, añade el campo `example`). Add this test:

```js
test('parsearPlantilla: carrusel expone bodyEjemplos y ejemplos por tarjeta', () => {
  const t = {
    name: 'car2', language: 'es',
    components: [
      { type: 'BODY', text: 'Invita a {{1}}', example: { body_text: [['participar en familia']] } },
      { type: 'CAROUSEL', cards: [
        { components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/a.jpg'] } },
          { type: 'BODY', text: 'Evento {{1}} en {{2}}', example: { body_text: [['Eucaristía', 'Catedral']] } },
        ] },
      ] },
    ],
  };
  const p = parsearPlantilla(t);
  assert.deepEqual(p.carrusel.bodyEjemplos, ['participar en familia']);
  assert.deepEqual(p.carrusel.cards[0].ejemplos, ['Eucaristía', 'Catedral']);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: FAIL (`bodyEjemplos`/`ejemplos` son `undefined`).

- [ ] **Step 3: Implementar en `plantillas.js`**

In `parsearTarjeta`, add `ejemplos` to the returned object:

```js
    ejemplos: (body && body.example && body.example.body_text && body.example.body_text[0]) || [],
```

In `parsearPlantilla`, compute `bodyEjemplos` from the top BODY and include it in the `carrusel` object:

```js
  const bodyEjemplos = (body && body.example && body.example.body_text && body.example.body_text[0]) || [];
```
```js
    carrusel: carrusel ? { bodyVars: contarVariables(cuerpo), bodyEjemplos, cards: (carrusel.cards || []).map(parsearTarjeta) } : null,
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/plantillas.js test/plantillas-servicio.test.js
git commit -m "feat(carrusel): parsearPlantilla expone los ejemplos por variable"
```

---

## Task 4: Frontend — placeholders con ejemplos + `accept` JPEG/PNG

**Files:**
- Modify: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `plantilla.carrusel.bodyEjemplos` y `plantilla.carrusel.cards[ci].ejemplos` (Task 3).

- [ ] **Step 1: Placeholder del cuerpo general**

In `frontend/src/components/DifusionWizard.vue`, en el editor de carrusel, el input del cuerpo general — reemplazar su `:placeholder`:

```html
              <input v-for="(_, i) in carrusel.bodyVars" :key="'b' + i" v-model="carrusel.bodyVars[i]"
                class="w-full border rounded px-2 py-1 mb-1"
                :placeholder="(plantilla.carrusel.bodyEjemplos && plantilla.carrusel.bodyEjemplos[i]) ? ('Ej: ' + plantilla.carrusel.bodyEjemplos[i]) : ('Variable ' + (i + 1))" />
```

- [ ] **Step 2: `accept` del selector de imagen (sin webp)**

En el `<input type="file">` de cada tarjeta, cambiar el `accept`:

```html
                <input type="file" accept="image/jpeg,image/png" class="text-[12px]" @change="(e) => onArchivoTarjeta(e, ci)" />
```

- [ ] **Step 3: Placeholder de las variables de cada tarjeta**

En el input de las variables de la tarjeta — reemplazar su `:placeholder`:

```html
              <input v-for="(_, vi) in card.vars" :key="'v' + ci + '_' + vi" v-model="card.vars[vi]"
                class="w-full border rounded px-2 py-1"
                :placeholder="(plantilla.carrusel.cards[ci].ejemplos && plantilla.carrusel.cards[ci].ejemplos[vi]) ? ('Ej: ' + plantilla.carrusel.cards[ci].ejemplos[vi]) : ('Variable ' + (vi + 1))" />
```

- [ ] **Step 4: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).
(El componente no tiene test unitario directo; se valida por build y en vivo.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DifusionWizard.vue
git commit -m "feat(carrusel): placeholders con el ejemplo de la plantilla y accept JPEG/PNG"
```

---

## Despliegue (tras merge)

Backend (servicios/controller) + worker (usa `plantillas.js`) + frontend; sin migración:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. En el wizard, elegir la plantilla de carrusel: cada variable muestra el ejemplo de la plantilla como placeholder ("Ej: …").
2. Subir un **WebP** (o renombrado a `.jpg`) → lo rechaza con "formato no soportado: usa JPEG o PNG".
3. Subir dos imágenes de **aspecto distinto** en las tarjetas → al iniciar avisa "las tarjetas deben tener la misma relación de aspecto" y no arranca.
4. Con dos JPEG del mismo aspecto → inicia y envía normal (sin regresión).

## Self-review

- **Cobertura del spec:** validación tipo/tamaño (T1), aspecto (T2), ejemplos backend (T3), placeholders + accept frontend (T4). Aplica a subida por tarjeta y a imagen única (T1 cambia `guardarImagen` para ambas).
- **Tipos consistentes:** `leerImagen → {formato,ancho,alto}`; `guardarImagen → {url,ancho,alto}`; tarjeta persiste `ancho`/`alto`; `carruselListo` los lee; `parsearPlantilla.carrusel.bodyEjemplos` y `cards[i].ejemplos` usados por el wizard con esos nombres.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
