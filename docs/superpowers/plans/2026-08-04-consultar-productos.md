# Consultar productos por cédula — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un popup "Consultar productos" (desde el menú) donde se ingresa una cédula y se ven, a la vez, previsión + mantenimiento + prenecesidad, con el dinero formateado.

**Architecture:** Endpoint `GET /api/productos?documento=` (requireAuth) que corre las 3 integraciones existentes en paralelo, cada una envuelta en un helper `seguro` que nunca lanza (estado ok/no_configurado/error). Frontend: un modal `PanelProductos.vue` + un util de tablas compartido con formateo de dinero.

**Tech Stack:** Node.js CommonJS, Express, `node --test`; Vue 3 `<script setup>` + Pinia + Tailwind, Vitest.

## Global Constraints

- Aislamiento: las integraciones a BD externas solo viven en `src/integrations/*` (ya existen); el nuevo endpoint solo las orquesta.
- El endpoint NUNCA 500 por el fallo de una sola integración: cada una va en `seguro`.
- Acceso: `requireAuth` (todos). No se asocia a ningún contacto.
- Dinero formateado SOLO en el popup nuevo (no se toca el formato de `PanelCliente`).
- `logger` (nunca `console.log`); dominio en español, técnico en inglés.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- Create `src/controllers/productosController.js` — `seguro` (testeable) + `consultar`.
- Modify `src/routes/api.js` — ruta `GET /productos`.
- Test `test/productos.test.js` — `seguro`.
- Create `frontend/src/utils/tablas.js` — `etiquetaCampo`, `formatoValor`, `esMoneda`, `formatoCelda`.
- Test `frontend/src/utils/tablas.test.js`.
- Modify `frontend/src/components/PanelCliente.vue` — importar `etiquetaCampo`/`formatoValor` del util (quitar copias locales).
- Create `frontend/src/components/PanelProductos.vue` — modal.
- Modify `frontend/src/stores/acciones.js` — `consultarProductos`.
- Modify `frontend/src/views/Bandeja.vue` — ítem de menú + montaje del modal.

---

## Task 1: Backend — endpoint `/productos`

**Files:**
- Create: `src/controllers/productosController.js`
- Modify: `src/routes/api.js`
- Test: `test/productos.test.js`

**Interfaces:**
- Produces:
  - `seguro(fn, doc) -> Promise<{estado:'ok', datos}|{estado:'no_configurado'}|{estado:'error'}>` — nunca lanza.
  - Ruta `GET /api/productos?documento=` → `{ documento, prevision, mantenimientos, prenecesidad }`.

- [ ] **Step 1: Write the failing tests**

Create `test/productos.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seguro } = require('../src/controllers/productosController');

test('seguro: éxito → estado ok con datos', async () => {
  const r = await seguro(async () => [{ a: 1 }], '123');
  assert.deepEqual(r, { estado: 'ok', datos: [{ a: 1 }] });
});

test('seguro: no_configurado → estado no_configurado', async () => {
  const r = await seguro(async () => { const e = new Error('x'); e.codigo = 'no_configurado'; throw e; }, '123');
  assert.deepEqual(r, { estado: 'no_configurado' });
});

test('seguro: otro error → estado error (no lanza)', async () => {
  const r = await seguro(async () => { throw new Error('boom'); }, '123');
  assert.deepEqual(r, { estado: 'error' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/productos.test.js`
Expected: FAIL — no existe el módulo/controlador.

- [ ] **Step 3: Implement the controller**

Create `src/controllers/productosController.js`:

```javascript
'use strict';
const logger = require('../utils/logger');
const { consultarPlanesPorDocumento } = require('../integrations/prevision/cliente');
const { consultarMantenimientos } = require('../integrations/mantenimientos/cliente');
const { consultarPrenecesidad } = require('../integrations/prenecesidad/cliente');

function soloDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

/** Ejecuta una consulta de producto sin lanzar: devuelve su estado + datos. */
async function seguro(fn, doc) {
  try {
    return { estado: 'ok', datos: await fn(doc) };
  } catch (err) {
    if (err.codigo === 'no_configurado') return { estado: 'no_configurado' };
    logger.error(`consultar producto (doc ${doc}): ${err.message}`);
    return { estado: 'error' };
  }
}

/** GET /api/productos?documento= — previsión + mantenimiento + prenecesidad en paralelo. */
async function consultar(req, res) {
  const doc = soloDigitos(req.query.documento);
  if (!doc) return res.status(400).json({ error: 'documento requerido' });
  const [prevision, mantenimientos, prenecesidad] = await Promise.all([
    seguro(consultarPlanesPorDocumento, doc),
    seguro(consultarMantenimientos, doc),
    seguro(consultarPrenecesidad, doc),
  ]);
  return res.json({ documento: doc, prevision, mantenimientos, prenecesidad });
}

module.exports = { seguro, consultar };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/productos.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the route**

En `src/routes/api.js`, añade el require y la ruta:

```javascript
const productosCtrl = require('../controllers/productosController');
```
y (junto a las otras rutas, p. ej. tras `/contactos/informe`):
```javascript
router.get('/productos', requireAuth, productosCtrl.consultar);
```

- [ ] **Step 6: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/productosController.js src/routes/api.js test/productos.test.js
git commit -m "feat(productos): endpoint GET /productos (3 productos por cédula, en paralelo)"
```

---

## Task 2: Frontend — util de tablas (con formato de dinero)

**Files:**
- Create: `frontend/src/utils/tablas.js`
- Test: `frontend/src/utils/tablas.test.js`
- Modify: `frontend/src/components/PanelCliente.vue`

**Interfaces:**
- Produces: `etiquetaCampo(k)`, `formatoValor(v)`, `esMoneda(col)`, `formatoCelda(col, v)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/tablas.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { etiquetaCampo, formatoValor, esMoneda, formatoCelda } from './tablas';

describe('etiquetaCampo', () => {
  it('reemplaza guiones bajos y capitaliza', () => {
    expect(etiquetaCampo('saldo_pendiente')).toBe('Saldo pendiente');
  });
});

describe('formatoValor', () => {
  it('vacío → guion, fecha ISO → fecha local, resto string', () => {
    expect(formatoValor(null)).toBe('—');
    expect(formatoValor('')).toBe('—');
    expect(formatoValor('2025-10-28T00:00:00.000Z')).toMatch(/2025/);
    expect(formatoValor(5)).toBe('5');
  });
});

describe('esMoneda', () => {
  it('detecta columnas de dinero', () => {
    expect(esMoneda('Vr. Cuota')).toBe(true);
    expect(esMoneda('Vr. Abonado')).toBe(true);
    expect(esMoneda('Saldo Pendiente')).toBe(true);
    expect(esMoneda('valor')).toBe(true);
    expect(esMoneda('total_pagado')).toBe(true);
  });
  it('NO marca columnas que no son dinero', () => {
    expect(esMoneda('Plazo')).toBe(false);
    expect(esMoneda('# Cuotas Vencidas')).toBe(false);
    expect(esMoneda('Cuota Pendiente')).toBe(false);
    expect(esMoneda('Contrato')).toBe(false);
  });
});

describe('formatoCelda', () => {
  it('dinero → $ con separadores de miles', () => {
    expect(formatoCelda('Vr. Abonado', 1627500)).toBe('$1.627.500');
  });
  it('número no-moneda → sin $', () => {
    expect(formatoCelda('Plazo', 1)).toBe('1');
  });
  it('fecha y vacío se comportan como formatoValor', () => {
    expect(formatoCelda('Fecha Vencimiento', null)).toBe('—');
    expect(formatoCelda('Expedicion', '2025-10-28T00:00:00.000Z')).toMatch(/2025/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix frontend test`
Expected: FAIL — no existe `./tablas`.

- [ ] **Step 3: Implement the util**

Create `frontend/src/utils/tablas.js`:

```javascript
// Helpers de render de tablas (previsión/mantenimiento/prenecesidad). Puros.

export function etiquetaCampo(k) {
  return String(k).replace(/_/g, ' ').replace(/\bplan\b/gi, '').trim().replace(/^\w/, (m) => m.toUpperCase());
}

export function formatoValor(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString('es-CO');
  return String(v);
}

// Una columna es "dinero" por su nombre (no por su valor), para no formatear Plazo/# cuotas.
export function esMoneda(col) {
  return /(vr\.?|valor|saldo|abonado|pagado|precio|monto)/i.test(String(col));
}

export function formatoCelda(col, v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number' && esMoneda(col)) return `$${v.toLocaleString('es-CO')}`;
  return formatoValor(v);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Refactor `PanelCliente.vue` to import the shared helpers**

En `PanelCliente.vue`, **elimina** las definiciones locales de `etiquetaCampo` y `formatoValor` (las líneas `function etiquetaCampo(k) {...}` y `function formatoValor(v) {...}`) y en su lugar impórtalas del util (junto a los otros imports del `<script setup>`):

```javascript
import { etiquetaCampo, formatoValor } from '../utils/tablas';
```

(No cambies `celda`, `columnas*`, ni los `CAMPOS_OCULTOS*`; siguen usando `formatoValor`/`etiquetaCampo` importados. El comportamiento visible no cambia.)

- [ ] **Step 6: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests en verde (incluye los nuevos de `tablas`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/tablas.js frontend/src/utils/tablas.test.js frontend/src/components/PanelCliente.vue
git commit -m "feat(productos): util de tablas con formato de dinero + reuso en PanelCliente"
```

---

## Task 3: Frontend — modal `PanelProductos` + menú

**Files:**
- Create: `frontend/src/components/PanelProductos.vue`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: `GET /productos` (Task 1); `etiquetaCampo`/`formatoCelda` (Task 2).
- Produces: `consultarProductos(documento)`; componente `PanelProductos.vue`; ítem de menú.

- [ ] **Step 1: Store action**

En `frontend/src/stores/acciones.js`:

```javascript
    async consultarProductos(documento) {
      return apiFetch(`/productos?documento=${encodeURIComponent(documento)}`);
    },
```

- [ ] **Step 2: Create `PanelProductos.vue`**

```html
<script setup>
import { ref } from 'vue';
import { useAcciones } from '../stores/acciones';
import { etiquetaCampo, formatoCelda } from '../utils/tablas';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();

const documento = ref('');
const datos = ref(null);
const cargando = ref(false);
const error = ref('');

async function consultar() {
  const doc = documento.value.replace(/\D/g, '');
  if (!doc) { error.value = 'Ingresa una cédula.'; return; }
  cargando.value = true; error.value = ''; datos.value = null;
  try { datos.value = await acc.consultarProductos(doc); }
  catch (e) { error.value = e.message || 'No se pudo consultar.'; }
  finally { cargando.value = false; }
}

const SECCIONES = [
  { key: 'prevision', titulo: 'Previsión' },
  { key: 'mantenimientos', titulo: 'Mantenimientos' },
  { key: 'prenecesidad', titulo: 'Prenecesidad' },
];
const columnas = (datos) => (datos && datos.length ? Object.keys(datos[0]) : []);
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-5xl max-h-[88vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Consultar productos</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>

      <div class="flex items-center gap-2 px-4 py-3 border-b">
        <input v-model="documento" inputmode="numeric" placeholder="Cédula del cliente"
          class="flex-1 border rounded px-3 py-1.5 text-[13px]" @keyup.enter="consultar" />
        <button class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px]" @click="consultar">Consultar</button>
      </div>

      <div class="overflow-auto p-4">
        <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Consultando…</div>
        <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
        <div v-else-if="!datos" class="text-center text-gray-400 text-sm py-6">Ingresa una cédula y pulsa Consultar.</div>
        <template v-else>
          <div v-for="s in SECCIONES" :key="s.key" class="mb-5">
            <div class="text-[13px] font-semibold text-marca-oscuro mb-1">{{ s.titulo }}</div>
            <div v-if="datos[s.key].estado === 'no_configurado'" class="text-[12px] text-gray-400">No configurado.</div>
            <div v-else-if="datos[s.key].estado === 'error'" class="text-[12px] text-red-500">No se pudo consultar.</div>
            <div v-else-if="!datos[s.key].datos || !datos[s.key].datos.length" class="text-[12px] text-gray-400">Sin resultados.</div>
            <div v-else class="overflow-x-auto border rounded">
              <table class="w-full text-[12px]">
                <thead class="bg-gray-50 text-gray-500">
                  <tr>
                    <th v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1.5 border-b whitespace-nowrap font-medium text-left">{{ etiquetaCampo(k) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in datos[s.key].datos" :key="i" class="border-b border-gray-100 hover:bg-gray-50">
                    <td v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1 text-gray-800 align-top"
                      :class="/observ/i.test(k) ? 'whitespace-normal min-w-[220px] max-w-[360px]' : 'whitespace-nowrap'">{{ formatoCelda(k, row[k]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Menú + montaje en `Bandeja.vue`**

En el menú desplegable (junto a "📋 Informe de contactos"), añade el ítem:
```html
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarProductos = true">🔎 Consultar productos</button>
```
En `<script setup>`: `const mostrarProductos = ref(false);` (junto a los otros `mostrar*`) e importa el componente `import PanelProductos from '../components/PanelProductos.vue';`.
Y monta el modal junto a los otros (`<PanelAgentes .../>` etc.):
```html
    <PanelProductos v-if="mostrarProductos" @cerrar="mostrarProductos = false" />
```

- [ ] **Step 4: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests en verde.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PanelProductos.vue frontend/src/stores/acciones.js frontend/src/views/Bandeja.vue
git commit -m "feat(productos): modal Consultar productos por cédula (3 secciones)"
```

---

## Deploy (tras aprobar e implementar)

Solo código (sin migración):
1. `git pull` + `npm --prefix frontend run build`.
2. `pm2 restart wa-backend`.
3. Verificación en vivo: menú → 🔎 Consultar productos → cédula (p. ej. 1004997123) → ver Previsión + Mantenimientos + Prenecesidad; confirmar dinero con `$` y miles.

## Fuera de alcance

- Crear/guardar contacto desde el popup; export; caché; formato de dinero en `PanelCliente`.
