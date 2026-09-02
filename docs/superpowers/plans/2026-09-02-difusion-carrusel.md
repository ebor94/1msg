# Difusión de plantillas tipo CAROUSEL — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir difundir plantillas WhatsApp tipo CAROUSEL: el frontend entiende la estructura (variable general + N tarjetas × sus variables + imágenes) y el backend arma el `params` de carrusel ya confirmado en 1msg.

**Architecture:** Enfoque A del spec — columna JSON `carrusel` en `wa_difusiones` (contenido fijo por campaña) + una rama en el armado del envío. `parsearPlantilla` expone la estructura del carrusel; `construirParamsCarrusel` arma el payload; `payloadDeEnvio` bifurca. Imágenes por tarjeta se suben como archivo (reusando el almacenamiento local existente, con nombre indexado). El wizard de difusión gana una rama de UI para carrusel; el envío manual oculta los carruseles.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize, MySQL 8 (JSON), Vue 3 + Pinia + Vitest, Socket.io, `node:test`.

Spec: `docs/superpowers/specs/2026-09-02-difusion-carrusel-design.md`. Formato de envío confirmado: memoria `formato-carrusel-1msg`.

## Global Constraints

- Solo tablas con prefijo `wa_` en `serfuweb`. No tocar tablas del core.
- Solo `src/integrations/onemsg/` habla con 1msg o construye URLs de 1msg. **No inventar formato**: el `params` de carrusel replica el confirmado en producción.
- Solo `src/integrations/anthropic/` importa el SDK de Anthropic (no aplica aquí).
- SQL siempre parametrizado. Sin secretos en el repo. Sin `console.log` (logger con niveles).
- Nombres de dominio en español, técnicos en inglés. Sequelize `underscored: true`, timestamps manuales.
- Sin dependencias nuevas (nada de Redis/BullMQ). No romper plantillas planas (regresión cero: `esCarrusel === false` mantiene todos los caminos actuales).
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.
- Migraciones a mano: `set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/012-*.sql`

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `docs/migraciones/012-difusion-carrusel.sql` | columna `carrusel` JSON | Crear |
| `src/models/Difusion.js` | mapear la columna `carrusel` | Modificar |
| `src/services/plantillas.js` | parsear carrusel + `construirParamsCarrusel` | Modificar |
| `test/plantillas-servicio.test.js` | tests de parseo + builder | Modificar |
| `src/services/difusionEnvio.js` | `payloadDeEnvio` bifurca a carrusel | Modificar |
| `test/difusion-envio.test.js` | test de bifurcación | Modificar |
| `src/services/difusionImagen.js` | nombre de imagen indexado por tarjeta | Modificar |
| `test/difusion-imagen.test.js` | test del nombre indexado | Modificar |
| `src/controllers/difusionesController.js` | `subirImagenCarrusel` + `crear` pasa `carrusel` | Modificar |
| `src/routes/api.js` | ruta de imagen por tarjeta | Modificar |
| `src/services/difusiones.js` | `crear` persiste `carrusel`, `iniciar` valida, helpers puros | Modificar |
| `test/difusion-servicio.test.js` | tests de `normalizarCarrusel` + `carruselListo` | Modificar |
| `frontend/src/utils/difusion.js` | helpers `initCarrusel` + `carruselBackend` | Modificar |
| `frontend/src/utils/difusion.test.js` | tests de los helpers | Modificar |
| `frontend/src/stores/acciones.js` | `subirImagenCarruselDifusion` | Modificar |
| `frontend/src/components/DifusionWizard.vue` | rama de UI para carrusel | Modificar |
| `frontend/src/components/SelectorPlantilla.vue` | ocultar carruseles en envío manual | Modificar |

---

## Task 1: Migración 012 + modelo — columna `carrusel`

**Files:**
- Create: `docs/migraciones/012-difusion-carrusel.sql`
- Modify: `src/models/Difusion.js`

**Interfaces:**
- Produces: `Difusion.carrusel` — columna JSON nullable. Cuando no es null: `{ bodyVars: string[], cards: [{ imagenUrl: string|null, vars: string[] }] }`.

- [ ] **Step 1: Escribir la migración**

Create `docs/migraciones/012-difusion-carrusel.sql`:

```sql
-- 012 — Contenido de plantillas tipo carrusel para una difusión (fijo por campaña).
-- Presente ⇒ la difusión es de carrusel: { bodyVars:[...], cards:[{ imagenUrl, vars:[...] }] }.
ALTER TABLE wa_difusiones
  ADD COLUMN carrusel JSON NULL AFTER imagen_url;
```

- [ ] **Step 2: Mapear la columna en el modelo**

In `src/models/Difusion.js`, add the field right after `imagenUrl`:

```js
      imagenUrl: { type: DataTypes.STRING(255), allowNull: true },
      carrusel: { type: DataTypes.JSON, allowNull: true },
```

- [ ] **Step 3: Verificar sintaxis del modelo**

Run: `cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/models/Difusion.js`
Expected: sin salida (OK).

- [ ] **Step 4: Commit**

```bash
git add docs/migraciones/012-difusion-carrusel.sql src/models/Difusion.js
git commit -m "feat(carrusel): columna JSON carrusel en wa_difusiones (migración 012)"
```

---

## Task 2: `parsearPlantilla` expone la estructura del carrusel

**Files:**
- Modify: `src/services/plantillas.js`
- Test: `test/plantillas-servicio.test.js`

**Interfaces:**
- Consumes: `contarVariables` (ya en el archivo).
- Produces: `parsearPlantilla(t)` gana dos campos:
  - `esCarrusel: boolean`
  - `carrusel: { bodyVars: number, cards: [{ variables: number, tieneImagen: boolean, imagenDefault: string|null, botones: string[] }] } | null`

- [ ] **Step 1: Escribir el test que falla**

In `test/plantillas-servicio.test.js`, add:

```js
const plantillaCarrusel = {
  name: 'olivos_carrusel_sfn',
  language: 'es',
  category: 'MARKETING',
  namespace: '8297ac0c_48d8_4ec6_a482_3b545f0544ed',
  components: [
    { type: 'BODY', text: 'Los olivos te invita a , {{1}} , en los siguientes eventos :' },
    {
      type: 'CAROUSEL',
      cards: [
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/img/a.jpg'] } },
            { type: 'BODY', text: 'Evento: {{1}} , | Lugar : {{2}}  |  Fecha : {{3}} | Hora : {{4}} .' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Asistiré' }, { type: 'QUICK_REPLY', text: 'No Asistiré' }] },
          ],
        },
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://x/img/b.jpg'] } },
            { type: 'BODY', text: 'Evento: {{1}} , | Lugar : {{2}}  |  Fecha : {{3}} | Hora : {{4}} .' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Asistiré' }, { type: 'QUICK_REPLY', text: 'No Asistiré' }] },
          ],
        },
      ],
    },
  ],
};

test('parsearPlantilla: carrusel expone bodyVars, tarjetas, imágenes y botones', () => {
  const p = parsearPlantilla(plantillaCarrusel);
  assert.equal(p.esCarrusel, true);
  assert.equal(p.carrusel.bodyVars, 1);
  assert.equal(p.carrusel.cards.length, 2);
  assert.equal(p.carrusel.cards[0].variables, 4);
  assert.equal(p.carrusel.cards[0].tieneImagen, true);
  assert.equal(p.carrusel.cards[0].imagenDefault, 'https://x/img/a.jpg');
  assert.deepEqual(p.carrusel.cards[0].botones, ['Asistiré', 'No Asistiré']);
});

test('parsearPlantilla: plantilla plana no es carrusel', () => {
  const p = parsearPlantilla({ name: 'plana', language: 'es', components: [{ type: 'BODY', text: 'Hola {{1}}' }] });
  assert.equal(p.esCarrusel, false);
  assert.equal(p.carrusel, null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: FAIL (`esCarrusel`/`carrusel` son `undefined`).

- [ ] **Step 3: Implementar el parseo del carrusel**

In `src/services/plantillas.js`, add a helper before `parsearPlantilla`:

```js
function parsearTarjeta(card) {
  const comps = card.components || [];
  const body = comps.find((c) => c.type === 'BODY');
  const header = comps.find((c) => c.type === 'HEADER');
  const buttons = comps.find((c) => c.type === 'BUTTONS');
  const esImagen = !!(header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format));
  return {
    variables: contarVariables((body && body.text) || ''),
    tieneImagen: esImagen,
    imagenDefault: esImagen ? (header.example && header.example.header_handle && header.example.header_handle[0]) || null : null,
    botones: buttons ? (buttons.buttons || []).map((b) => b.text) : [],
  };
}
```

Then in `parsearPlantilla`, after computing `cuerpo`, add and include in the returned object:

```js
  const carrusel = comps.find((c) => c.type === 'CAROUSEL');
```

```js
    esCarrusel: !!carrusel,
    carrusel: carrusel ? { bodyVars: contarVariables(cuerpo), cards: (carrusel.cards || []).map(parsearTarjeta) } : null,
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: PASS (incl. los tests previos del archivo).

- [ ] **Step 5: Commit**

```bash
git add src/services/plantillas.js test/plantillas-servicio.test.js
git commit -m "feat(carrusel): parsearPlantilla expone estructura de carrusel"
```

---

## Task 3: `construirParamsCarrusel` — builder puro del payload

**Files:**
- Modify: `src/services/plantillas.js`
- Test: `test/plantillas-servicio.test.js`

**Interfaces:**
- Produces: `construirParamsCarrusel(contenido, def)` donde
  - `contenido = { bodyVars: string[], cards: [{ imagenUrl: string|null, vars: string[] }] }` (valores fijos, de `dif.carrusel`)
  - `def = { cards: [{ botones: string[] }] }` (de `parsearPlantilla(...).carrusel`, para los botones)
  - Devuelve el array `params` de `sendTemplate`: `[{type:'body',...}?, {type:'carousel', cards:[...]}]`, replicando el payload confirmado.
- Exportar en `module.exports`.

- [ ] **Step 1: Escribir el test que falla**

In `test/plantillas-servicio.test.js`, add at the top the import update and a test. Update the require line to include the new export:

```js
const { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, parsearPlantilla, construirParamsCarrusel } = require('../src/services/plantillas');
```

```js
test('construirParamsCarrusel: body + carousel con card_index, header, body y botones', () => {
  const contenido = {
    bodyVars: ['participar en familia'],
    cards: [
      { imagenUrl: 'https://x/a.jpg', vars: ['Conferencia', 'Calle 6', 'Sábado', '3pm'] },
      { imagenUrl: 'https://x/b.jpg', vars: ['Eucaristía', 'Catedral', 'Viernes', '6pm'] },
    ],
  };
  const def = { cards: [{ botones: ['Asistiré', 'No Asistiré'] }, { botones: ['Asistiré', 'No Asistiré'] }] };
  const params = construirParamsCarrusel(contenido, def);

  assert.equal(params[0].type, 'body');
  assert.deepEqual(params[0].parameters, [{ type: 'text', text: 'participar en familia' }]);

  const car = params[1];
  assert.equal(car.type, 'carousel');
  assert.equal(car.cards.length, 2);
  assert.equal(car.cards[0].card_index, 0);
  assert.deepEqual(car.cards[0].components[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://x/a.jpg' } }] });
  assert.equal(car.cards[0].components[1].type, 'body');
  assert.equal(car.cards[0].components[1].parameters.length, 4);
  assert.deepEqual(car.cards[0].components[2], { type: 'button', sub_type: 'quick_reply', index: 0, parameters: [{ type: 'payload', payload: 'asistire_c0' }] });
  assert.equal(car.cards[0].components[3].parameters[0].payload, 'no_asistire_c0');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: FAIL (`construirParamsCarrusel` no es una función).

- [ ] **Step 3: Implementar el builder**

In `src/services/plantillas.js`, add:

```js
function slugBoton(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Pura: arma el `params` de sendTemplate para una plantilla tipo carrusel. */
function construirParamsCarrusel(contenido, def) {
  const bodyVars = (contenido && contenido.bodyVars) || [];
  const params = [];
  if (bodyVars.length) {
    params.push({ type: 'body', parameters: bodyVars.map((v) => ({ type: 'text', text: String(v) })) });
  }
  const cards = ((contenido && contenido.cards) || []).map((card, i) => {
    const botonesDef = (def && def.cards && def.cards[i] && def.cards[i].botones) || [];
    const components = [];
    if (card.imagenUrl) {
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link: String(card.imagenUrl) } }] });
    }
    if ((card.vars || []).length) {
      components.push({ type: 'body', parameters: card.vars.map((v) => ({ type: 'text', text: String(v) })) });
    }
    botonesDef.forEach((texto, idx) => {
      components.push({ type: 'button', sub_type: 'quick_reply', index: idx, parameters: [{ type: 'payload', payload: `${slugBoton(texto)}_c${i}` }] });
    });
    return { card_index: i, components };
  });
  params.push({ type: 'carousel', cards });
  return params;
}
```

Update `module.exports` to include it:

```js
module.exports = { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, construirParamsCarrusel, parsearPlantilla };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/plantillas.js test/plantillas-servicio.test.js
git commit -m "feat(carrusel): construirParamsCarrusel arma el payload confirmado"
```

---

## Task 4: `payloadDeEnvio` bifurca a carrusel

**Files:**
- Modify: `src/services/difusionEnvio.js`
- Test: `test/difusion-envio.test.js`

**Interfaces:**
- Consumes: `construirParamsCarrusel` (Task 3), `def.esCarrusel`/`def.carrusel` (Task 2), `dif.carrusel` (Task 1).
- Produces: `payloadDeEnvio(dif, def, dest, telefono)` sin cambio de firma; cuando `def.esCarrusel && dif.carrusel`, `params` = carrusel; si no, el camino actual.
- Produces: `textoYMediaSaliente(dif, def, dest) → { texto: string, mediaUrl: string|null }` — lo que se guarda en el mensaje saliente de la bandeja. Carrusel: cuerpo general renderizado con `dif.carrusel.bodyVars` + marca `📸 Carrusel (N tarjetas)`, `mediaUrl` = imagen de la 1ª tarjeta. Plano: comportamiento actual.

- [ ] **Step 1: Escribir el test que falla**

In `test/difusion-envio.test.js`, add (mira el `require` del archivo; usa el mismo import de `payloadDeEnvio`):

```js
test('payloadDeEnvio: carrusel usa el builder de carrusel', () => {
  const dif = { plantillaNombre: 'car', plantillaIdioma: 'es', carrusel: { bodyVars: ['x'], cards: [{ imagenUrl: 'https://x/a.jpg', vars: ['a', 'b', 'c', 'd'] }] } };
  const def = { esCarrusel: true, namespace: 'ns', carrusel: { cards: [{ botones: ['Asistiré'] }] } };
  const p = payloadDeEnvio(dif, def, { parametros: [] }, '573001112233');
  assert.equal(p.phone, '573001112233');
  assert.equal(p.namespace, 'ns');
  assert.equal(p.params[0].type, 'body');
  assert.equal(p.params[1].type, 'carousel');
  assert.equal(p.params[1].cards[0].card_index, 0);
});

test('payloadDeEnvio: plantilla plana mantiene el camino actual', () => {
  const dif = { plantillaNombre: 'plana', plantillaIdioma: 'es', imagenUrl: null };
  const def = { esCarrusel: false, namespace: 'ns', tieneImagen: false };
  const p = payloadDeEnvio(dif, def, { parametros: ['Ana'] }, '573001112233');
  assert.equal(p.params.length, 1);
  assert.equal(p.params[0].type, 'body');
  assert.equal(p.params[0].parameters[0].text, 'Ana');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-envio.test.js`
Expected: FAIL (el carrusel entra por el camino plano y `params[1]` es undefined).

- [ ] **Step 3: Implementar la bifurcación**

In `src/services/difusionEnvio.js`, update the import to add `construirParamsCarrusel`:

```js
const { construirParams, construirParamsHeader, construirParamsCarrusel, renderizarCuerpo } = require('./plantillas');
```

Replace `payloadDeEnvio` with:

```js
/** Pura: arma el cuerpo de enviarPlantilla (carrusel, o header de imagen + body). */
function payloadDeEnvio(dif, def, dest, telefono) {
  const base = {
    phone: telefono,
    template: dif.plantillaNombre,
    language: { code: dif.plantillaIdioma || def.language || 'es', policy: 'deterministic' },
    namespace: def.namespace || null,
  };
  if (def.esCarrusel && dif.carrusel) {
    return { ...base, params: construirParamsCarrusel(dif.carrusel, def.carrusel) };
  }
  const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
  return { ...base, params: [...header, ...construirParams(dest.parametros)] };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-envio.test.js`
Expected: PASS.

- [ ] **Step 5: Escribir el test del texto/media saliente (falla)**

In `test/difusion-envio.test.js`, add (importa `textoYMediaSaliente` junto a `payloadDeEnvio`):

```js
test('textoYMediaSaliente: carrusel usa cuerpo general + marca + 1ª imagen', () => {
  const dif = { carrusel: { bodyVars: ['Ana'], cards: [{ imagenUrl: 'https://x/a.jpg', vars: [] }, { imagenUrl: 'https://x/b.jpg', vars: [] }] } };
  const def = { esCarrusel: true, cuerpo: 'Hola {{1}}' };
  const r = textoYMediaSaliente(dif, def, { parametros: [] });
  assert.equal(r.texto, 'Hola Ana 📸 Carrusel (2 tarjetas)');
  assert.equal(r.mediaUrl, 'https://x/a.jpg');
});

test('textoYMediaSaliente: plano renderiza con parametros y respeta imagen', () => {
  const dif = { imagenUrl: 'https://x/h.jpg' };
  const def = { esCarrusel: false, cuerpo: 'Hola {{1}}', tieneImagen: true };
  const r = textoYMediaSaliente(dif, def, { parametros: ['Ana'] });
  assert.equal(r.texto, 'Hola Ana');
  assert.equal(r.mediaUrl, 'https://x/h.jpg');
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-envio.test.js`
Expected: FAIL (`textoYMediaSaliente` no es una función).

- [ ] **Step 7: Implementar el helper y cablearlo**

In `src/services/difusionEnvio.js`, add the helper:

```js
/** Pura: texto y media que se guardan en el mensaje saliente de la bandeja. */
function textoYMediaSaliente(dif, def, dest) {
  if (def.esCarrusel && dif.carrusel) {
    const cards = dif.carrusel.cards || [];
    const texto = `${renderizarCuerpo(def.cuerpo, dif.carrusel.bodyVars || [])} 📸 Carrusel (${cards.length} tarjetas)`.trim();
    return { texto, mediaUrl: (cards[0] && cards[0].imagenUrl) || null };
  }
  return {
    texto: renderizarCuerpo(def.cuerpo, dest.parametros),
    mediaUrl: def.tieneImagen ? (dif.imagenUrl || def.imagenDefault) : null,
  };
}
```

In `enviarDestinatario`, replace the two lines that compute `texto` and `mediaUrl`:

```js
  const texto = renderizarCuerpo(def.cuerpo, dest.parametros);
  const mediaUrl = def.tieneImagen ? (dif.imagenUrl || def.imagenDefault) : null;
```
with:
```js
  const { texto, mediaUrl } = textoYMediaSaliente(dif, def, dest);
```

Add `textoYMediaSaliente` to `module.exports`.

- [ ] **Step 8: Correr la suite y verificar que pasa (sin regresiones)**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-envio.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/difusionEnvio.js test/difusion-envio.test.js
git commit -m "feat(carrusel): payloadDeEnvio bifurca + texto/media saliente del carrusel"
```

---

## Task 5: Subida de imagen por tarjeta (nombre indexado + endpoint)

**Files:**
- Modify: `src/services/difusionImagen.js`
- Test: `test/difusion-imagen.test.js`
- Modify: `src/controllers/difusionesController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Produces: `nombreArchivoImagen(difusionId, mime, cardIndex?)` — con `cardIndex` → `dif-{id}-c{idx}.{ext}`; sin él → `dif-{id}.{ext}` (actual). `guardarImagen(difusionId, buffer, mime, cardIndex?)` reenvía el índice.
- Produces: controller `subirImagenCarrusel(req, res)` — guarda la imagen de `:idx` y hace merge inmutable de `carrusel.cards[idx].imagenUrl`.
- Produces: ruta `POST /api/difusiones/:id/carrusel/:idx/imagen`.

- [ ] **Step 1: Escribir el test que falla (nombre indexado)**

In `test/difusion-imagen.test.js`, add:

```js
test('nombreArchivoImagen: con índice de tarjeta añade sufijo -cN', () => {
  assert.equal(nombreArchivoImagen(15, 'image/jpeg', 0), 'dif-15-c0.jpg');
  assert.equal(nombreArchivoImagen(15, 'image/png', 2), 'dif-15-c2.png');
  assert.equal(nombreArchivoImagen(15, 'image/jpeg'), 'dif-15.jpg'); // sin índice: comportamiento actual
});
```

(Confirma que el archivo ya importa `nombreArchivoImagen`; si no, añádelo al require.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-imagen.test.js`
Expected: FAIL (el sufijo `-cN` no existe).

- [ ] **Step 3: Implementar el nombre indexado**

In `src/services/difusionImagen.js`, replace `nombreArchivoImagen` and `guardarImagen`:

```js
/** Nombre determinístico por campaña (y por tarjeta si se da cardIndex); rechaza mimes no soportados. */
function nombreArchivoImagen(difusionId, mime, cardIndex) {
  const ext = EXT_POR_MIME[String(mime || '').toLowerCase()];
  if (!ext) throw err400('formato de imagen no soportado (usa png/jpg/webp)');
  const sufijo = cardIndex === undefined || cardIndex === null ? '' : `-c${Number(cardIndex)}`;
  return `dif-${difusionId}${sufijo}.${ext}`;
}
```

```js
/** Guarda la imagen y devuelve su URL pública persistente. */
async function guardarImagen(difusionId, buffer, mime, cardIndex) {
  const nombre = nombreArchivoImagen(difusionId, mime, cardIndex);
  const abs = rutaAbsolutaImagen(nombre);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  const base = (env.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { rutaRelativa: path.join(SUBDIR, nombre), url: `${base}/media-difusion/${nombre}` };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-imagen.test.js`
Expected: PASS.

- [ ] **Step 5: Añadir el controller `subirImagenCarrusel`**

In `src/controllers/difusionesController.js`, add after `subirImagen`:

```js
async function subirImagenCarrusel(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'falta el archivo' });
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ error: 'índice de tarjeta inválido' });
    const dif = await Difusion.findByPk(req.params.id);
    if (!dif) return res.status(404).json({ error: 'difusión no encontrada' });
    if (!dif.carrusel || !Array.isArray(dif.carrusel.cards) || !dif.carrusel.cards[idx]) {
      return res.status(400).json({ error: 'la difusión no tiene esa tarjeta de carrusel' });
    }
    const { url } = await guardarImagen(req.params.id, req.file.buffer, req.file.mimetype, idx);
    // Sequelize no detecta la mutación in-place de un campo JSON: se asigna un objeto nuevo.
    const carrusel = { ...dif.carrusel, cards: dif.carrusel.cards.map((c, i) => (i === idx ? { ...c, imagenUrl: url } : c)) };
    await dif.update({ carrusel });
    return res.json({ imagenUrl: url });
  } catch (err) { return fallo(res, err, 'no se pudo subir la imagen de la tarjeta'); }
}
```

Add `subirImagenCarrusel` to `module.exports`.

- [ ] **Step 6: Añadir la ruta**

In `src/routes/api.js`, after the `/difusiones/:id/imagen` route, add:

```js
router.post('/difusiones/:id/carrusel/:idx/imagen', requireAuth, requireAdmin, subirImagen, difusionesCtrl.subirImagenCarrusel);
```

- [ ] **Step 7: Verificar sintaxis + suite backend (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/controllers/difusionesController.js && node --check src/routes/api.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: sintaxis OK; `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add src/services/difusionImagen.js test/difusion-imagen.test.js src/controllers/difusionesController.js src/routes/api.js
git commit -m "feat(carrusel): subida de imagen por tarjeta (endpoint + nombre indexado)"
```

---

## Task 6: `crear` persiste el carrusel; `iniciar` lo valida

**Files:**
- Modify: `src/services/difusiones.js`
- Test: `test/difusion-servicio.test.js`
- Modify: `src/controllers/difusionesController.js`

**Interfaces:**
- Produces (puras, exportadas para test): `normalizarCarrusel(entrada, def) → { bodyVars: string[], cards: [{ imagenUrl: null, vars: string[] }] }` (dimensiona según `def.carrusel`); `carruselListo(dif, def) → { ok: boolean, motivo?: string }`.
- `crear(...)` acepta `carrusel` y lo persiste (solo si `def.esCarrusel`). `iniciar(...)` valida el carrusel antes de arrancar.
- El controller `crear` pasa `carrusel: b.carrusel` al servicio.

- [ ] **Step 1: Escribir los tests que fallan**

In `test/difusion-servicio.test.js`, add (importa las dos funciones puras desde el servicio):

```js
const { normalizarCarrusel, carruselListo } = require('../src/services/difusiones');

test('normalizarCarrusel dimensiona bodyVars y cards según la plantilla', () => {
  const def = { carrusel: { bodyVars: 1, cards: [{ variables: 4 }, { variables: 4 }] } };
  const out = normalizarCarrusel({ bodyVars: ['top'], cards: [{ vars: ['a', 'b', 'c', 'd'] }] }, def);
  assert.deepEqual(out.bodyVars, ['top']);
  assert.equal(out.cards.length, 2);
  assert.deepEqual(out.cards[0].vars, ['a', 'b', 'c', 'd']);
  assert.equal(out.cards[0].imagenUrl, null);
  assert.deepEqual(out.cards[1].vars, ['', '', '', '']); // la 2ª tarjeta llega vacía
});

test('carruselListo exige imágenes y textos de cada tarjeta', () => {
  const def = { esCarrusel: true, carrusel: { bodyVars: 1, cards: [{ variables: 4, tieneImagen: true }] } };
  const incompleta = { carrusel: { bodyVars: ['x'], cards: [{ imagenUrl: null, vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(incompleta, def).ok, false);
  const completa = { carrusel: { bodyVars: ['x'], cards: [{ imagenUrl: 'https://x/a.jpg', vars: ['a', 'b', 'c', 'd'] }] } };
  assert.equal(carruselListo(completa, def).ok, true);
});

test('carruselListo: plantilla plana siempre ok', () => {
  assert.equal(carruselListo({}, { esCarrusel: false }).ok, true);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-servicio.test.js`
Expected: FAIL (`normalizarCarrusel`/`carruselListo` no exportadas).

- [ ] **Step 3: Implementar los helpers puros y cablearlos**

In `src/services/difusiones.js`, add near `puedeIniciar`:

```js
/** Pura: da forma al contenido del carrusel según la plantilla (rellena huecos vacíos). */
function normalizarCarrusel(entrada, def) {
  const src = entrada || {};
  const nBody = (def.carrusel && def.carrusel.bodyVars) || 0;
  const bodyVars = Array.from({ length: nBody }, (_, i) => String((src.bodyVars || [])[i] ?? ''));
  const cards = ((def.carrusel && def.carrusel.cards) || []).map((cDef, i) => {
    const cIn = (src.cards || [])[i] || {};
    return {
      imagenUrl: cIn.imagenUrl || null,
      vars: Array.from({ length: cDef.variables || 0 }, (_, j) => String((cIn.vars || [])[j] ?? '')),
    };
  });
  return { bodyVars, cards };
}

/** Pura: valida que un carrusel esté listo para enviar (imágenes + textos completos). */
function carruselListo(dif, def) {
  if (!def || !def.esCarrusel) return { ok: true };
  const c = dif.carrusel;
  const cardsDef = (def.carrusel && def.carrusel.cards) || [];
  if (!c || !Array.isArray(c.cards) || c.cards.length !== cardsDef.length) {
    return { ok: false, motivo: 'el contenido del carrusel está incompleto' };
  }
  for (let i = 0; i < c.cards.length; i += 1) {
    const cardDef = cardsDef[i];
    const card = c.cards[i] || {};
    if (cardDef.tieneImagen && !card.imagenUrl) return { ok: false, motivo: `falta la imagen de la tarjeta ${i + 1}` };
    const llenas = (card.vars || []).filter((v) => String(v).trim()).length;
    if (llenas < (cardDef.variables || 0)) return { ok: false, motivo: `faltan textos en la tarjeta ${i + 1}` };
  }
  return { ok: true };
}
```

In `crear`, update the signature and the `Difusion.create` call:

```js
async function crear({ nombre, plantilla, idioma, categoria, requiereResumen, carrusel, creadoPorId }) {
```

```js
  return Difusion.create({
    nombre, plantillaNombre: plantilla, plantillaIdioma: idioma || def.language || 'es',
    categoria: String(categoria || def.categoria || 'utility').toLowerCase(), estado: 'borrador',
    canalId: canal.id, creadoPorId, requiereResumen: !!requiereResumen,
    carrusel: def.esCarrusel ? normalizarCarrusel(carrusel, def) : null,
  });
```

In `iniciar`, add the carousel validation before the `puedeIniciar` check:

```js
async function iniciar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  if (dif.carrusel) {
    const def = (await obtenerCatalogo()).find((p) => p.name === dif.plantillaNombre);
    const chk = carruselListo(dif, def || {});
    if (!chk.ok) throw err(400, chk.motivo);
  }
  const pendientes = await DifusionDestinatario.count({ where: { difusionId, estado: 'pendiente' } });
  if (!puedeIniciar(dif.estado, pendientes)) throw err(409, 'la campaña no se puede iniciar (revisa estado y destinatarios)');
  await dif.update({ estado: 'enviando' });
}
```

Update `module.exports` to add `normalizarCarrusel, carruselListo`.

- [ ] **Step 4: Pasar `carrusel` desde el controller**

In `src/controllers/difusionesController.js`, in `crear`, add `carrusel` to the `servicio.crear(...)` call:

```js
    const dif = await servicio.crear({
      nombre: b.nombre, plantilla: b.plantilla, idioma: b.idioma, categoria: b.categoria,
      requiereResumen: b.requiereResumen, carrusel: b.carrusel, creadoPorId: req.agente.id,
    });
```

- [ ] **Step 5: Correr los tests y verificar que pasan (+ sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/difusiones.js && node --check src/controllers/difusionesController.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: sintaxis OK; `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/services/difusiones.js test/difusion-servicio.test.js src/controllers/difusionesController.js
git commit -m "feat(carrusel): crear persiste el carrusel e iniciar valida imágenes/textos"
```

---

## Task 7: Frontend — helpers puros de carrusel

**Files:**
- Modify: `frontend/src/utils/difusion.js`
- Test: `frontend/src/utils/difusion.test.js`

**Interfaces:**
- Produces: `initCarrusel(def) → { bodyVars: string[], cards: [{ vars: string[], imagenFile: null, imagenUrl: null }] } | null` (estado editable del wizard, dimensionado según la plantilla).
- Produces: `carruselBackend(estado) → { bodyVars: string[], cards: [{ vars: string[] }] }` (lo que va al backend en `crear`; sin imágenes, se suben aparte).

- [ ] **Step 1: Escribir los tests que fallan**

In `frontend/src/utils/difusion.test.js`, add (respeta el estilo de import del archivo — Vitest):

```js
import { initCarrusel, carruselBackend } from './difusion';

describe('carrusel', () => {
  const def = { carrusel: { bodyVars: 1, cards: [{ variables: 4 }, { variables: 2 }] } };

  it('initCarrusel dimensiona bodyVars y las vars de cada tarjeta', () => {
    const est = initCarrusel(def);
    expect(est.bodyVars).toEqual(['']);
    expect(est.cards.length).toBe(2);
    expect(est.cards[0].vars).toEqual(['', '', '', '']);
    expect(est.cards[1].vars).toEqual(['', '']);
    expect(est.cards[0].imagenFile).toBe(null);
  });

  it('initCarrusel devuelve null si la plantilla no es carrusel', () => {
    expect(initCarrusel({ carrusel: null })).toBe(null);
  });

  it('carruselBackend deja solo bodyVars y vars (sin imágenes)', () => {
    const est = { bodyVars: ['x'], cards: [{ vars: ['a', 'b'], imagenFile: {}, imagenUrl: 'u' }] };
    expect(carruselBackend(est)).toEqual({ bodyVars: ['x'], cards: [{ vars: ['a', 'b'] }] });
  });
});
```

(Si el archivo usa `test(...)` en vez de `describe/it`, adáptalo al estilo presente.)

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/utils/difusion.test.js`
Expected: FAIL (`initCarrusel`/`carruselBackend` no existen).

- [ ] **Step 3: Implementar los helpers**

In `frontend/src/utils/difusion.js`, add:

```js
// Estado editable del wizard para una plantilla de carrusel (o null si no lo es).
export function initCarrusel(def) {
  const c = def && def.carrusel;
  if (!c) return null;
  return {
    bodyVars: Array.from({ length: c.bodyVars || 0 }, () => ''),
    cards: (c.cards || []).map((card) => ({
      vars: Array.from({ length: card.variables || 0 }, () => ''),
      imagenFile: null,
      imagenUrl: null,
    })),
  };
}

// Contenido del carrusel que va al backend en `crear` (las imágenes se suben aparte).
export function carruselBackend(estado) {
  return {
    bodyVars: [...((estado && estado.bodyVars) || [])],
    cards: ((estado && estado.cards) || []).map((c) => ({ vars: [...(c.vars || [])] })),
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/utils/difusion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/difusion.js frontend/src/utils/difusion.test.js
git commit -m "feat(carrusel): helpers de carrusel para el wizard (frontend)"
```

---

## Task 8: Frontend — acción de subida por tarjeta + rama del wizard

**Files:**
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `initCarrusel`, `carruselBackend` (Task 7); `crearDifusion` (acepta `carrusel`), `cargarDestinatariosDifusion`, `iniciarDifusion` (ya existen).
- Produces: `acciones.subirImagenCarruselDifusion(id, idx, file) → { imagenUrl }`.

- [ ] **Step 1: Añadir la acción de subida por tarjeta**

In `frontend/src/stores/acciones.js`, add right after `subirImagenDifusion`:

```js
    async subirImagenCarruselDifusion(id, idx, file) {
      const fd = new FormData();
      fd.append('imagen', file);
      const token = tokenGuardado();
      const resp = await fetch(`/api/difusiones/${id}/carrusel/${idx}/imagen`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let cuerpo = null;
      try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }
      if (!resp.ok) { const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`); e.status = resp.status; throw e; }
      return cuerpo;
    },
```

- [ ] **Step 2: Rama de carrusel en el wizard — script**

In `frontend/src/components/DifusionWizard.vue`, update the imports and add carousel state/logic.

Update the import line:

```js
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable, columnasRequeridas, initCarrusel, carruselBackend } from '../utils/difusion';
```

Add state near the other refs:

```js
const carrusel = ref(null); // estado editable cuando la plantilla es carrusel
const esCarrusel = computed(() => !!plantilla.value?.esCarrusel);
```

Replace `elegirPlantilla` with:

```js
function elegirPlantilla() {
  const p = plantilla.value;
  mapeo.value.variables = p && !p.esCarrusel ? Array.from({ length: p.variables }, () => ({ tipo: 'columna', columna: '', valor: '' })) : [];
  carrusel.value = p && p.esCarrusel ? initCarrusel(p) : null;
}
```

Add a handler for per-card image selection:

```js
function onArchivoTarjeta(ev, i) { carrusel.value.cards[i].imagenFile = ev.target.files?.[0] || null; }
```

Replace `crearYCargar` with a version that handles carousel (crear con contenido → subir imágenes por tarjeta → cargar destinatarios):

```js
async function crearYCargar() {
  error.value = ''; guardando.value = true;
  try {
    if (!difusionId.value) {
      const datos = { nombre: nombre.value, plantilla: plantillaNombre.value, requiereResumen: requiereResumen.value };
      if (esCarrusel.value) datos.carrusel = carruselBackend(carrusel.value);
      const dif = await acc.crearDifusion(datos);
      difusionId.value = dif.id;
    }
    if (esCarrusel.value) {
      for (let i = 0; i < carrusel.value.cards.length; i += 1) {
        const card = carrusel.value.cards[i];
        if (card.imagenFile) { const r = await acc.subirImagenCarruselDifusion(difusionId.value, i, card.imagenFile); card.imagenUrl = r.imagenUrl; }
      }
    } else if (plantilla.value?.tieneImagen && imagenFile.value) {
      await acc.subirImagenDifusion(difusionId.value, imagenFile.value);
    }
    resumen.value = await acc.cargarDestinatariosDifusion(difusionId.value, { texto: csvTexto.value, mapeo: mapeoBackend() });
  } catch (e) {
    error.value = e.message || 'No se pudo crear la campaña.';
  } finally {
    guardando.value = false;
  }
}
```

Update `puedeCargar` so carousel requires every card to have an image selected:

```js
const faltaImagenCarrusel = computed(() =>
  esCarrusel.value && (carrusel.value?.cards || []).some((c, i) => plantilla.value.carrusel.cards[i].tieneImagen && !c.imagenFile && !c.imagenUrl));
const puedeCargar = computed(() => nombre.value.trim() && plantillaNombre.value && csvTexto.value.trim() && !faltaImagen.value && !faltaImagenCarrusel.value);
```

- [ ] **Step 3: Rama de carrusel en el wizard — template**

In `frontend/src/components/DifusionWizard.vue`, wrap the existing "Variables" block and the single-image block so they only show for **non-carousel** templates, and add the carousel editor.

Change the opening of the variables block:

```html
          <!-- Paso 2: mapeo de variables (solo plantillas planas) -->
          <div v-if="!esCarrusel && plantilla.variables" class="space-y-2">
```

Change the single-image block condition:

```html
          <!-- Imagen si la plantilla plana la lleva -->
          <div v-if="!esCarrusel && plantilla.tieneImagen">
```

Add the carousel editor right after the single-image block:

```html
          <!-- Editor de carrusel -->
          <div v-if="esCarrusel && carrusel" class="space-y-3">
            <div v-if="carrusel.bodyVars.length">
              <div class="text-[11px] text-gray-400 uppercase mb-1">Texto de arriba</div>
              <input v-for="(_, i) in carrusel.bodyVars" :key="'b' + i" v-model="carrusel.bodyVars[i]"
                class="w-full border rounded px-2 py-1 mb-1" :placeholder="'Variable ' + (i + 1)" />
            </div>
            <div v-for="(card, ci) in carrusel.cards" :key="'c' + ci" class="border rounded p-2 space-y-2">
              <div class="text-[12px] font-semibold text-gray-700">Tarjeta {{ ci + 1 }}</div>
              <div v-if="plantilla.carrusel.cards[ci].tieneImagen">
                <label class="block text-[11px] text-gray-400 mb-1">Imagen de la tarjeta</label>
                <input type="file" accept="image/png,image/jpeg,image/webp" class="text-[12px]" @change="(e) => onArchivoTarjeta(e, ci)" />
                <span v-if="card.imagenFile" class="text-[11px] text-green-600 ml-1">✓ {{ card.imagenFile.name }}</span>
              </div>
              <input v-for="(_, vi) in card.vars" :key="'v' + ci + '_' + vi" v-model="card.vars[vi]"
                class="w-full border rounded px-2 py-1" :placeholder="'Variable ' + (vi + 1)" />
            </div>
          </div>
```

Also, so the CSV step of a carousel only needs the phone column, `mapeoBackend()` already emits `variables: []` for carousel (Task 8 Step 2 set `mapeo.value.variables = []`), and `columnasRequeridas` already returns only `telefono`/`agente` (+`CEDULA`) when `variables` is empty — no change needed there.

- [ ] **Step 4: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).
(El componente no tiene test unitario directo; se apoya en los helpers ya testeados —Task 7— y se valida en vivo.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/acciones.js frontend/src/components/DifusionWizard.vue
git commit -m "feat(carrusel): rama de carrusel en el wizard de difusión + subida por tarjeta"
```

---

## Task 9: Frontend — ocultar carruseles en el envío manual

**Files:**
- Modify: `frontend/src/components/SelectorPlantilla.vue`

**Interfaces:**
- Consumes: `acc.plantillas` (cada ítem con `esCarrusel`).

- [ ] **Step 1: Filtrar los carruseles de la lista**

In `frontend/src/components/SelectorPlantilla.vue`, add a computed after the store setup:

```js
const plantillasEnviables = computed(() => acc.plantillas.filter((p) => !p.esCarrusel));
```

Import `computed` if not already imported (it is: `import { ref, computed, onMounted } from 'vue';`).

In the template, change the list to iterate `plantillasEnviables` and its empty-state check:

```html
        <div v-for="p in plantillasEnviables" :key="p.name" @click="elegir(p)"
```

```html
        <div v-if="!plantillasEnviables.length" class="text-center text-gray-400 text-sm py-4">Cargando plantillas…</div>
```

- [ ] **Step 2: Build**

Run: `npm --prefix frontend run build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SelectorPlantilla.vue
git commit -m "feat(carrusel): ocultar plantillas de carrusel en el envío manual"
```

---

## Despliegue (tras merge a main)

Cambia backend (modelo/servicios/rutas), worker (usa `plantillas.js`/`difusionEnvio.js`), frontend, y hay migración:

```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only'
# Migración 012:
ssh mantix 'cd ~/apps/wa && set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/012-difusion-carrusel.sql'
# Build + reinicio (backend Y worker: ambos cargan plantillas.js/difusionEnvio.js):
ssh mantix 'cd ~/apps/wa && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. Crear una difusión eligiendo `olivos_carrusel_sfn`: el wizard muestra el texto de arriba + las 2 tarjetas (imagen + 4 variables cada una), y el CSV solo pide la columna de teléfono.
2. Subir una imagen por tarjeta, llenar los textos, pegar un CSV con 1–2 teléfonos de prueba, cargar destinatarios e iniciar.
3. Confirmar en el/los teléfono(s) que llega el carrusel con las 2 tarjetas (imagen + textos + botones "Asistiré/No Asistiré").
4. Confirmar que una difusión de plantilla **plana** sigue funcionando igual (sin regresión).

---

## Notas de verificación cruzada (self-review)

- **Cobertura del spec:** modelo/migración (T1), parseo (T2), builder confirmado (T3), envío bifurcado + texto/media saliente del carrusel (T4, Steps 5–9), imágenes por tarjeta (T5), crear/validar (T6), helpers y wizard frontend (T7–T8), ocultar en manual (T9). El mensaje saliente en la bandeja guarda el cuerpo general renderizado con `dif.carrusel.bodyVars` + marca `📸 Carrusel (N tarjetas)` y `mediaUrl` = 1ª imagen (Task 4). Límites v1 aceptados (resumen IA representa el envío con el cuerpo general; conteo de botones fuera de v1) según el spec.
- **Tipos consistentes:** `carrusel` (valores) = `{ bodyVars: string[], cards: [{ imagenUrl, vars }] }` en todo el backend; `def.carrusel` (estructura) = `{ bodyVars: number, cards: [{ variables, tieneImagen, imagenDefault, botones }] }`. `construirParamsCarrusel(contenido, def)` usa ambos con esos nombres.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
