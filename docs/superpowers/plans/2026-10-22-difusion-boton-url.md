# Difusión: plantillas con botón de URL — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soportar en la difusión plantillas planas con un botón de URL dinámico (variable en la URL), con el valor del botón fijo por campaña, para poder enviar `mensaje_boton_link` masivamente.

**Architecture:** `parsearPlantilla` expone el botón de URL y sus variables; `payloadDeEnvio` agrega el componente `button` (sub_type url); el valor fijo se guarda en una columna `boton_params` de la difusión; el wizard lo pide cuando la plantilla tiene botón de URL.

**Tech Stack:** Node 20 CommonJS, Express, Sequelize (JSON), Vue 3 + Pinia + Vitest, `node:test`.

Spec: `docs/superpowers/specs/2026-10-22-difusion-boton-url-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. No dependencias nuevas.
- Solo afecta el camino **plano** del envío; carrusel e imagen de header NO cambian.
- Valores del botón **fijos** por campaña (no per-destinatario).
- Formato del componente (confirmado por el usuario con 1msg): `{ "type":"button", "index":<n>, "sub_type":"url", "parameters":[{ "type":"text", "text":"<valor>" }] }`.
- `contarVariables` cuenta `{{n}}` distintos (ya existe en `plantillas.js`).
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (suite completa `test/*.test.js 2>&1 | tail -4`, reporter `ℹ`, `fail 0`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.
- Migración a mano: `set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/014-*.sql`

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/plantillas.js` | `parsearPlantilla.botonUrl` + `construirParamsBotonUrl` | Modificar |
| `test/plantillas-servicio.test.js` | tests de parseo + builder | Modificar |
| `src/services/difusionEnvio.js` | `payloadDeEnvio` agrega el botón | Modificar |
| `test/difusion-envio.test.js` | test de payload con botón | Modificar |
| `docs/migraciones/014-difusion-boton.sql` | columna `boton_params` | Crear |
| `src/models/Difusion.js` | mapear `botonParams` | Modificar |
| `src/services/difusiones.js` | `crear` persiste + `faltaBotonUrl` + `iniciar` guard | Modificar |
| `test/difusion-servicio.test.js` | test de `faltaBotonUrl` | Modificar |
| `src/controllers/difusionesController.js` | `crear` pasa `botonParams` | Modificar |
| `frontend/src/components/DifusionWizard.vue` | input(s) del botón | Modificar |

---

## Task 1: `parsearPlantilla` expone el botón de URL + `construirParamsBotonUrl`

**Files:**
- Modify: `src/services/plantillas.js`
- Test: `test/plantillas-servicio.test.js`

**Interfaces:**
- Produces: `parsearPlantilla(t).botonUrl = { index, variables, texto, ejemplos } | null`.
- Produces: `construirParamsBotonUrl(valores, index) → array` (componente button, o `[]`), exportada.

- [ ] **Step 1: Escribir los tests que fallan**

In `test/plantillas-servicio.test.js`, update the require to add `construirParamsBotonUrl`:

```js
const { contarVariables, renderizarCuerpo, construirParams, construirParamsHeader, construirParamsCarrusel, construirParamsBotonUrl, parsearPlantilla } = require('../src/services/plantillas');
```

Add:

```js
const plantillaBoton = {
  name: 'mensaje_boton_link', language: 'es',
  components: [
    { type: 'BODY', text: 'Los Olivos, {{1}} . Gracias' },
    { type: 'FOOTER', text: 'Los Olivos, un homenaje al amor' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Respnder', url: 'https://losolivoscucuta.com/{{1}}', example: ['bigDay-encuesta/'] }] },
  ],
};

test('parsearPlantilla: expone botonUrl (index, variables, texto, ejemplos)', () => {
  const p = parsearPlantilla(plantillaBoton);
  assert.deepEqual(p.botonUrl, { index: 0, variables: 1, texto: 'Respnder', ejemplos: ['bigDay-encuesta/'] });
});
test('parsearPlantilla: sin botón de URL con variables → botonUrl null', () => {
  const p = parsearPlantilla({ name: 'plana', language: 'es', components: [{ type: 'BODY', text: 'Hola {{1}}' }] });
  assert.equal(p.botonUrl, null);
});

test('construirParamsBotonUrl: arma el componente button; vacío → []', () => {
  assert.deepEqual(construirParamsBotonUrl(['bigDay-encuesta/'], 0), [{ type: 'button', index: 0, sub_type: 'url', parameters: [{ type: 'text', text: 'bigDay-encuesta/' }] }]);
  assert.deepEqual(construirParamsBotonUrl([], 0), []);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: FAIL (`botonUrl`/`construirParamsBotonUrl` no existen).

- [ ] **Step 3: Implementar**

In `src/services/plantillas.js`, inside `parsearPlantilla`, after the `carrusel` line, add:

```js
  const buttons = comps.find((c) => c.type === 'BUTTONS');
  const botonUrlDef = buttons && (buttons.buttons || []).find((b) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url || ''));
```

And add this field to the returned object:

```js
    botonUrl: botonUrlDef ? {
      index: (buttons.buttons || []).indexOf(botonUrlDef),
      variables: contarVariables(botonUrlDef.url || ''),
      texto: botonUrlDef.text || '',
      ejemplos: botonUrlDef.example || [],
    } : null,
```

Add the builder (near `construirParams`):

```js
function construirParamsBotonUrl(valores, index) {
  if (!valores || !valores.length) return [];
  return [{ type: 'button', index: index || 0, sub_type: 'url', parameters: valores.map((v) => ({ type: 'text', text: String(v) })) }];
}
```

Add `construirParamsBotonUrl` to `module.exports`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/plantillas-servicio.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/plantillas.js test/plantillas-servicio.test.js
git commit -m "feat(difusion): parsear botón de URL y construir su componente

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `payloadDeEnvio` agrega el botón de URL

**Files:**
- Modify: `src/services/difusionEnvio.js`
- Test: `test/difusion-envio.test.js`

**Interfaces:**
- Consumes: `construirParamsBotonUrl` (Task 1), `def.botonUrl`, `dif.botonParams`.
- Produces: `payloadDeEnvio` (camino plano) agrega el componente button cuando corresponde.

- [ ] **Step 1: Escribir el test que falla**

In `test/difusion-envio.test.js`, add (usa el mismo import de `payloadDeEnvio`):

```js
test('payloadDeEnvio: plantilla con botón de URL incluye el componente button', () => {
  const dif = { plantillaNombre: 'b', plantillaIdioma: 'es', imagenUrl: null, botonParams: ['bigDay-encuesta/'] };
  const def = { esCarrusel: false, namespace: 'ns', tieneImagen: false, botonUrl: { index: 0, variables: 1 } };
  const p = payloadDeEnvio(dif, def, { parametros: ['hola'] }, '573001112233');
  assert.equal(p.params[0].type, 'body');
  const btn = p.params.find((x) => x.type === 'button');
  assert.ok(btn, 'debe incluir el componente button');
  assert.equal(btn.sub_type, 'url');
  assert.equal(btn.index, 0);
  assert.equal(btn.parameters[0].text, 'bigDay-encuesta/');
});

test('payloadDeEnvio: plantilla sin botón → sin componente button', () => {
  const dif = { plantillaNombre: 'plana', plantillaIdioma: 'es', imagenUrl: null };
  const def = { esCarrusel: false, namespace: 'ns', tieneImagen: false };
  const p = payloadDeEnvio(dif, def, { parametros: ['hola'] }, '573001112233');
  assert.equal(p.params.some((x) => x.type === 'button'), false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-envio.test.js`
Expected: FAIL (no se agrega el button).

- [ ] **Step 3: Implementar**

In `src/services/difusionEnvio.js`, update the import of `./plantillas` to include `construirParamsBotonUrl`:

```js
const { construirParams, construirParamsHeader, construirParamsCarrusel, construirParamsBotonUrl, renderizarCuerpo } = require('./plantillas');
```

In `payloadDeEnvio`, replace the plain-path return with:

```js
  const header = def.tieneImagen ? construirParamsHeader(dif.imagenUrl || def.imagenDefault) : [];
  const boton = (def.botonUrl && dif.botonParams) ? construirParamsBotonUrl(dif.botonParams, def.botonUrl.index) : [];
  return { ...base, params: [...header, ...construirParams(dest.parametros), ...boton] };
```

- [ ] **Step 4: Correr y verificar que pasa (+ sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/services/difusionEnvio.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/difusionEnvio.js test/difusion-envio.test.js
git commit -m "feat(difusion): payloadDeEnvio agrega el botón de URL en el camino plano

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Columna `boton_params` + `crear` + guard en `iniciar`

**Files:**
- Create: `docs/migraciones/014-difusion-boton.sql`
- Modify: `src/models/Difusion.js`
- Modify: `src/services/difusiones.js`
- Test: `test/difusion-servicio.test.js`
- Modify: `src/controllers/difusionesController.js`

**Interfaces:**
- Produces: `Difusion.botonParams` (JSON nullable); `crear(..., botonParams)` lo persiste; `faltaBotonUrl(dif, def) → boolean`; `iniciar` rechaza si falta el valor del botón.

- [ ] **Step 1: Migración**

Create `docs/migraciones/014-difusion-boton.sql`:

```sql
-- 014 — valores fijos del botón de URL para una difusión (array JSON, p. ej. ["bigDay-encuesta/"]).
ALTER TABLE wa_difusiones
  ADD COLUMN boton_params JSON NULL AFTER reasignar;
```

- [ ] **Step 2: Modelo**

In `src/models/Difusion.js`, after the `reasignar` field, add:

```js
      botonParams: { type: DataTypes.JSON, allowNull: true },
```

- [ ] **Step 3: Escribir el test de `faltaBotonUrl` (falla)**

In `test/difusion-servicio.test.js`, add (importa `faltaBotonUrl` desde el servicio):

```js
const { faltaBotonUrl } = require('../src/services/difusiones');

test('faltaBotonUrl: plantilla con botón sin valor → true; con valor → false', () => {
  const def = { botonUrl: { variables: 1, index: 0 } };
  assert.equal(faltaBotonUrl({ botonParams: [] }, def), true);
  assert.equal(faltaBotonUrl({ botonParams: ['  '] }, def), true);
  assert.equal(faltaBotonUrl({ botonParams: ['bigDay-encuesta/'] }, def), false);
});
test('faltaBotonUrl: plantilla sin botón → false', () => {
  assert.equal(faltaBotonUrl({ botonParams: null }, { botonUrl: null }), false);
});
```

- [ ] **Step 4: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/difusion-servicio.test.js`
Expected: FAIL (`faltaBotonUrl` no exportada).

- [ ] **Step 5: Implementar en `difusiones.js`**

Add the pure helper (cerca de `puedeIniciar`):

```js
/** Pura: true si la plantilla tiene botón de URL con variables y faltan valores. */
function faltaBotonUrl(dif, def) {
  if (!def || !def.botonUrl || !def.botonUrl.variables) return false;
  const vals = (dif.botonParams || []).filter((v) => String(v).trim());
  return vals.length < def.botonUrl.variables;
}
```

In `crear`, add `botonParams` to the destructure and `botonParams: botonParams || null` to `Difusion.create`:

```js
async function crear({ nombre, plantilla, idioma, categoria, requiereResumen, carrusel, reasignar, botonParams, creadoPorId }) {
```
```js
    botonParams: botonParams || null,
```

In `iniciar`, load `def` once and add the guard. Replace the top of `iniciar` with:

```js
async function iniciar(difusionId) {
  const dif = await Difusion.findByPk(difusionId);
  if (!dif) throw err(404, 'difusión no encontrada');
  const def = (await obtenerCatalogo()).find((p) => p.name === dif.plantillaNombre);
  if (dif.carrusel) {
    if (!def) throw err(400, 'plantilla no encontrada o no aprobada');
    const chk = carruselListo(dif, def);
    if (!chk.ok) throw err(400, chk.motivo);
  }
  if (def && def.botonUrl && faltaBotonUrl(dif, def)) {
    throw err(400, 'falta el valor del botón de enlace');
  }
```
(keep the rest of `iniciar` — the `pendientes`/`puedeIniciar` check and `dif.update({ estado: 'enviando' })` — unchanged.)

Add `faltaBotonUrl` to `module.exports`.

- [ ] **Step 6: Controller pasa `botonParams`**

In `src/controllers/difusionesController.js`, in `crear`, add `botonParams: b.botonParams` to the `servicio.crear({...})` call (junto a `reasignar: b.reasignar`).

- [ ] **Step 7: Verificar sintaxis + suite**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/models/Difusion.js && node --check src/services/difusiones.js && node --check src/controllers/difusionesController.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add docs/migraciones/014-difusion-boton.sql src/models/Difusion.js src/services/difusiones.js test/difusion-servicio.test.js src/controllers/difusionesController.js
git commit -m "feat(difusion): columna boton_params, crear la persiste e iniciar la valida (migración 014)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wizard — input(s) del botón de URL

**Files:**
- Modify: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `plantilla.botonUrl` (Task 1); `acc.crearDifusion` con `botonParams`.

- [ ] **Step 1: Estado + init al elegir plantilla**

In `frontend/src/components/DifusionWizard.vue`, add a ref near the others (p. ej. junto a `const carrusel = ref(null);`):

```js
const botonParams = ref([]);
```

In `elegirPlantilla`, after the `carrusel.value = ...` line, add:

```js
  botonParams.value = p && p.botonUrl ? Array.from({ length: p.botonUrl.variables }, (_, i) => (p.botonUrl.ejemplos && p.botonUrl.ejemplos[i]) || '') : [];
```

- [ ] **Step 2: Enviar `botonParams` en `crearYCargar`**

In `crearYCargar`, right after the `const datos = { ... }` line and the carousel `if (esCarrusel.value) datos.carrusel = ...`, add:

```js
      if (plantilla.value?.botonUrl) datos.botonParams = botonParams.value;
```

- [ ] **Step 3: Gate `puedeCargar`**

Add a computed near the other `falta*` computeds:

```js
const faltaBotonUrl = computed(() => !!plantilla.value?.botonUrl && (botonParams.value || []).some((v) => !String(v).trim()));
```

Extend `puedeCargar` (línea 103) to also require `!faltaBotonUrl.value`:

```js
const puedeCargar = computed(() => nombre.value.trim() && plantillaNombre.value && csvTexto.value.trim() && !faltaImagen.value && !faltaImagenCarrusel.value && !faltaTextoCarrusel.value && !(esCarrusel.value && carruselExcedeLimite(plantilla.value, carrusel.value)) && !faltaBotonUrl.value);
```

- [ ] **Step 4: Bloque de inputs del botón (template)**

In the template, after the single-image block (`v-if="!esCarrusel && plantilla.tieneImagen"`) and before the CSV step, add:

```html
          <!-- Valor(es) del botón de URL (plantillas con botón de enlace) -->
          <div v-if="!esCarrusel && plantilla.botonUrl" class="space-y-1">
            <div class="text-[11px] text-gray-400 uppercase">Botón: {{ plantilla.botonUrl.texto || 'enlace' }}</div>
            <input v-for="(_, i) in botonParams" :key="'btn' + i" v-model="botonParams[i]"
              class="w-full border rounded px-2 py-1.5"
              :placeholder="(plantilla.botonUrl.ejemplos && plantilla.botonUrl.ejemplos[i]) ? ('Ej: ' + plantilla.botonUrl.ejemplos[i]) : ('Valor del botón ' + (i + 1))" />
            <p class="text-[11px] text-gray-400">Se completa en el enlace del botón (p. ej. la ruta de la encuesta).</p>
          </div>
```

- [ ] **Step 5: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DifusionWizard.vue
git commit -m "feat(difusion): el wizard pide el valor del botón de URL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Despliegue (tras merge)

Backend + worker (usan `plantillas.js`/`difusionEnvio.js`/`difusiones.js`) + frontend; **con migración 014**:
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only'
ssh mantix 'cd ~/apps/wa && set -a && . ./.env && set +a && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" < docs/migraciones/014-difusion-boton.sql'
ssh mantix 'cd ~/apps/wa && npm --prefix frontend run build && pm2 restart wa-backend wa-worker'
```

**Verificación en vivo (usuario):**
1. Crear una difusión con `mensaje_boton_link`: el wizard pide el texto del cuerpo y el **valor del botón** (ej. `bigDay-encuesta/`); "Cargar" se bloquea si falta.
2. Enviar a 1–2 números de prueba → llega con el botón "Respnder" apuntando a `https://losolivoscucuta.com/bigDay-encuesta/`.
3. Una plantilla sin botón (p. ej. `evento_psicologia`) sigue enviándose igual (sin regresión).

## Self-review

- **Cobertura del spec:** parse botonUrl + builder (T1); payloadDeEnvio agrega el botón (T2); columna + crear + guard iniciar (T3); wizard (T4).
- **Tipos consistentes:** `parsearPlantilla.botonUrl = {index,variables,texto,ejemplos}`; `construirParamsBotonUrl(valores,index)`; `payloadDeEnvio` usa `def.botonUrl.index` + `dif.botonParams`; `faltaBotonUrl(dif,def)`; columna/campo `botonParams`.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
