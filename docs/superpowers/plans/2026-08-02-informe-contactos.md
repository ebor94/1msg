# Informe de contactos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla `/informe` con una lista de contactos filtrable (¿compró?, origen, interés, estado del chat, rango de fechas por última actividad) para hacer seguimiento; cualquier agente ve todos los contactos.

**Architecture:** Endpoint `GET /api/contactos/informe` (requireAuth) → servicio `informeContactos` con un parser de filtros PURO (testeable) + una consulta SQL (CTE con `ROW_NUMBER` para la conversación más reciente por contacto) que devuelve página + total, con las etiquetas adjuntadas en una segunda consulta. Frontend: una vista `Informe.vue` en su propia ruta, abierta desde el menú de la cabecera.

**Tech Stack:** Node.js CommonJS, Express, Sequelize (raw query, MySQL 8 CTE/window), `node --test`; Vue 3 `<script setup>` + Pinia + Vue Router + Tailwind, Vitest.

## Global Constraints

- Solo tablas `wa_`. SQL **parametrizado** (replacements), sin interpolar valores del usuario.
- Acceso: **todos ven todo** (`requireAuth`, sin `requireAdmin`). Excluir siempre `desactivado_en IS NOT NULL`.
- Unidad = contacto, representado por su conversación **más reciente** (`ROW_NUMBER() OVER (PARTITION BY contacto_id ORDER BY ultimo_mensaje_en DESC, id DESC)`).
- Rango de fechas sobre `ultimo_mensaje_en` (última actividad); `hasta` inclusive → `< hasta + 1 día`.
- `compro` ∈ {si,no,pendiente,sin}; `estado` ∈ {nueva,abierta,pendiente,cerrada,sin}; inválidos → 422. `origenId`/`interesId` no enteros → se ignoran (nunca 422).
- Paginación: `tam` 1..100 (default 25), `pagina` ≥ 0.
- `logger` (nunca `console.log`); dominio en español, técnico en inglés.
- Backend test: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
- Frontend: `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- Create `src/services/informeContactos.js` — `parsearFiltros` (puro) + `consultar` (SQL).
- Modify `src/controllers/contactosController.js` — handler `informe`.
- Modify `src/routes/api.js` — ruta `GET /contactos/informe`.
- Test `test/informe-contactos.test.js` — `parsearFiltros`.
- Create `frontend/src/views/Informe.vue` — pantalla.
- Modify `frontend/src/router/index.js` — ruta `/informe`.
- Modify `frontend/src/stores/acciones.js` — `cargarInforme`.
- Modify `frontend/src/views/Bandeja.vue` — ítem "📋 Informe" en el menú.

---

## Task 1: Servicio — parser de filtros (puro) + pruebas

**Files:**
- Create: `src/services/informeContactos.js`
- Test: `test/informe-contactos.test.js`

**Interfaces:**
- Produces: `parsearFiltros(query = {}) -> { compro?, estado?, origenId?, interesId?, desde?, hastaExcl?, tam, pagina }`. Lanza `{status:422}` para `compro`/`estado` inválidos o rango de fechas inválido.

- [ ] **Step 1: Write the failing tests**

Create `test/informe-contactos.test.js`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearFiltros } = require('../src/services/informeContactos');

test('vacío → solo paginación por defecto', () => {
  const f = parsearFiltros({});
  assert.equal(f.tam, 25);
  assert.equal(f.pagina, 0);
  assert.equal(f.compro, undefined);
  assert.equal(f.estado, undefined);
});

test('compro y estado válidos (incl. "sin")', () => {
  assert.equal(parsearFiltros({ compro: 'si' }).compro, 'si');
  assert.equal(parsearFiltros({ compro: 'sin' }).compro, 'sin');
  assert.equal(parsearFiltros({ estado: 'cerrada' }).estado, 'cerrada');
  assert.equal(parsearFiltros({ estado: 'sin' }).estado, 'sin');
});

test('compro inválido → 422', () => {
  assert.throws(() => parsearFiltros({ compro: 'quiza' }), (e) => e.status === 422);
});
test('estado inválido → 422', () => {
  assert.throws(() => parsearFiltros({ estado: 'archivada' }), (e) => e.status === 422);
});

test('origenId/interesId: enteros se toman, basura se ignora', () => {
  const f = parsearFiltros({ origenId: '3', interesId: 'x' });
  assert.equal(f.origenId, 3);
  assert.equal(f.interesId, undefined);
});

test('rango: hastaExcl = hasta + 1 día', () => {
  const f = parsearFiltros({ desde: '2026-07-01', hasta: '2026-07-31' });
  assert.equal(f.desde.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(f.hastaExcl.toISOString().slice(0, 10), '2026-08-01');
});
test('desde > hasta → 422', () => {
  assert.throws(() => parsearFiltros({ desde: '2026-08-01', hasta: '2026-07-01' }), (e) => e.status === 422);
});
test('fecha inválida → 422', () => {
  assert.throws(() => parsearFiltros({ desde: 'ayer' }), (e) => e.status === 422);
});

test('tam se acota 1..100 (default 25), pagina ≥ 0', () => {
  assert.equal(parsearFiltros({ tam: '500' }).tam, 100);
  assert.equal(parsearFiltros({ tam: '0' }).tam, 25);
  assert.equal(parsearFiltros({ tam: '10' }).tam, 10);
  assert.equal(parsearFiltros({ pagina: '-3' }).pagina, 0);
  assert.equal(parsearFiltros({ pagina: '2' }).pagina, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/informe-contactos.test.js`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implement `parsearFiltros`**

Create `src/services/informeContactos.js`:

```javascript
'use strict';

const COMPRO = ['si', 'no', 'pendiente'];
const ESTADOS = ['nueva', 'abierta', 'pendiente', 'cerrada'];
const UN_DIA_MS = 24 * 60 * 60 * 1000;

function err422(msg) { const e = new Error(msg); e.status = 422; return e; }

/** Valida y normaliza los filtros del querystring del informe. Puro (sin BD). */
function parsearFiltros(query = {}) {
  const f = {};

  if (query.compro !== undefined && query.compro !== '') {
    if (query.compro === 'sin' || COMPRO.includes(query.compro)) f.compro = query.compro;
    else throw err422('compro inválido');
  }
  if (query.estado !== undefined && query.estado !== '') {
    if (query.estado === 'sin' || ESTADOS.includes(query.estado)) f.estado = query.estado;
    else throw err422('estado inválido');
  }

  const oi = Number(query.origenId);
  if (Number.isInteger(oi) && oi > 0) f.origenId = oi;
  const ii = Number(query.interesId);
  if (Number.isInteger(ii) && ii > 0) f.interesId = ii;

  if (query.desde) {
    const d = new Date(`${query.desde}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw err422('fecha desde inválida');
    f.desde = d;
  }
  if (query.hasta) {
    const h = new Date(`${query.hasta}T00:00:00.000Z`);
    if (Number.isNaN(h.getTime())) throw err422('fecha hasta inválida');
    f.hastaExcl = new Date(h.getTime() + UN_DIA_MS);
  }
  if (f.desde && f.hastaExcl && f.desde >= f.hastaExcl) throw err422('desde > hasta');

  let tam = Number(query.tam);
  if (!Number.isInteger(tam) || tam < 1) tam = 25;
  if (tam > 100) tam = 100;
  let pagina = Number(query.pagina);
  if (!Number.isInteger(pagina) || pagina < 0) pagina = 0;
  f.tam = tam;
  f.pagina = pagina;

  return f;
}

module.exports = { parsearFiltros };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/informe-contactos.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/informeContactos.js test/informe-contactos.test.js
git commit -m "feat(informe): parser de filtros del informe de contactos"
```

---

## Task 2: Servicio — consulta SQL + endpoint

**Files:**
- Modify: `src/services/informeContactos.js`
- Modify: `src/controllers/contactosController.js`
- Modify: `src/routes/api.js`

**Interfaces:**
- Consumes: `parsearFiltros` (Task 1); `sequelize` de `../config/database`, `QueryTypes`.
- Produces:
  - `consultar(filtros) -> Promise<{ total, pagina, tam, contactos: [...] }>`. Cada contacto: `{ contactoId, nombre, telefono, agenteDueno, compro, conversacionId, estado, ultimaActividad, origen, intereses }`.
  - Ruta `GET /api/contactos/informe` (requireAuth) → ese objeto.

- [ ] **Step 1: Implement `consultar`**

Añade a `src/services/informeContactos.js` (antes de `module.exports`):

```javascript
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Construye las cláusulas WHERE + replacements según los filtros presentes.
function construirWhere(f) {
  const cond = ['c.desactivado_en IS NULL'];
  const repl = {};
  if (f.compro === 'sin') cond.push('c.compro IS NULL');
  else if (f.compro) { cond.push('c.compro = :compro'); repl.compro = f.compro; }
  if (f.estado === 'sin') cond.push('u.id IS NULL');
  else if (f.estado) { cond.push('u.estado = :estado'); repl.estado = f.estado; }
  if (f.desde) { cond.push('u.ultimo_mensaje_en >= :desde'); repl.desde = f.desde; }
  if (f.hastaExcl) { cond.push('u.ultimo_mensaje_en < :hastaExcl'); repl.hastaExcl = f.hastaExcl; }
  if (f.origenId) { cond.push('EXISTS (SELECT 1 FROM wa_conversacion_etiqueta ce WHERE ce.conversacion_id = u.id AND ce.etiqueta_id = :origenId)'); repl.origenId = f.origenId; }
  if (f.interesId) { cond.push('EXISTS (SELECT 1 FROM wa_conversacion_etiqueta ce WHERE ce.conversacion_id = u.id AND ce.etiqueta_id = :interesId)'); repl.interesId = f.interesId; }
  return { where: cond.join(' AND '), repl };
}

const CTE = `WITH ultima AS (
  SELECT id, contacto_id, estado, ultimo_mensaje_en,
         ROW_NUMBER() OVER (PARTITION BY contacto_id ORDER BY ultimo_mensaje_en DESC, id DESC) AS rn
  FROM wa_conversaciones
)`;

async function consultar(f) {
  const { where, repl } = construirWhere(f);
  const from = `FROM wa_contactos c
    LEFT JOIN ultima u ON u.contacto_id = c.id AND u.rn = 1
    LEFT JOIN wa_agentes ad ON ad.id = c.agente_dueno_id
   WHERE ${where}`;

  const [totalRow] = await sequelize.query(`${CTE} SELECT COUNT(*) AS n ${from}`, {
    type: QueryTypes.SELECT, replacements: repl,
  });
  const total = Number(totalRow.n);

  const filas = await sequelize.query(
    `${CTE}
     SELECT c.id AS contactoId, c.telefono,
            COALESCE(NULLIF(c.nombre_display, ''), NULLIF(c.nombre_wa, ''), c.telefono) AS nombre,
            c.compro, ad.nombre AS agenteDueno,
            u.id AS conversacionId, u.estado, u.ultimo_mensaje_en AS ultimaActividad
     ${from}
     ORDER BY u.ultimo_mensaje_en IS NULL, u.ultimo_mensaje_en DESC, c.id DESC
     LIMIT :tam OFFSET :offset`,
    { type: QueryTypes.SELECT, replacements: { ...repl, tam: f.tam, offset: f.pagina * f.tam } },
  );

  // Adjuntar etiquetas (origen 0..1 + intereses) por conversación de la página.
  const convIds = filas.map((r) => r.conversacionId).filter((x) => x != null);
  const porConv = new Map();
  if (convIds.length) {
    const etqs = await sequelize.query(
      `SELECT ce.conversacion_id AS convId, e.nombre, e.color, e.categoria
         FROM wa_conversacion_etiqueta ce JOIN wa_etiquetas e ON e.id = ce.etiqueta_id
        WHERE ce.conversacion_id IN (:convIds)`,
      { type: QueryTypes.SELECT, replacements: { convIds } },
    );
    for (const e of etqs) {
      if (!porConv.has(e.convId)) porConv.set(e.convId, { origen: null, intereses: [] });
      const bucket = porConv.get(e.convId);
      if (e.categoria === 'origen') { if (!bucket.origen) bucket.origen = { nombre: e.nombre, color: e.color }; }
      else bucket.intereses.push({ nombre: e.nombre, color: e.color });
    }
  }

  const contactos = filas.map((r) => {
    const et = porConv.get(r.conversacionId) || { origen: null, intereses: [] };
    return { ...r, origen: et.origen, intereses: et.intereses };
  });

  return { total, pagina: f.pagina, tam: f.tam, contactos };
}
```

Actualiza `module.exports`: `module.exports = { parsearFiltros, consultar };`

- [ ] **Step 2: Controller handler**

En `src/controllers/contactosController.js`, importa el servicio y añade el handler:

```javascript
const informeSvc = require('../services/informeContactos');

async function informe(req, res) {
  let filtros;
  try {
    filtros = informeSvc.parsearFiltros(req.query || {});
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ error: err.message });
    throw err;
  }
  try {
    return res.json(await informeSvc.consultar(filtros));
  } catch (err) {
    logger.error(`informe contactos: ${err.message}`);
    return res.status(500).json({ error: 'error interno' });
  }
}
```

Añade `informe` al `module.exports` del controlador.

- [ ] **Step 3: Route**

En `src/routes/api.js`, junto a las otras rutas de `/contactos` — **antes** de `GET /contactos/:id/...` no aplica (es literal), pero colócala junto a `/contactos/buscar`:

```javascript
router.get('/contactos/informe', requireAuth, contactosCtrl.informe);
```

- [ ] **Step 4: Full suite green**

Run: `JWT_SECRET=test_secret DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=VID ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js`
Expected: PASS.

- [ ] **Step 5: Manual verification (backend con BD)**

```bash
curl -s "localhost:3000/api/contactos/informe?compro=pendiente&tam=5" -H "Authorization: Bearer $TOK" | head -c 400
curl -s "localhost:3000/api/contactos/informe?estado=sin&tam=5" -H "Authorization: Bearer $TOK" | head -c 400
curl -s "localhost:3000/api/contactos/informe?compro=quiza" -H "Authorization: Bearer $TOK"   # 422
```
Expected: JSON `{ total, pagina, tam, contactos:[...] }`; `compro=quiza` → 422.

- [ ] **Step 6: Commit**

```bash
git add src/services/informeContactos.js src/controllers/contactosController.js src/routes/api.js
git commit -m "feat(informe): consulta y endpoint GET /contactos/informe"
```

---

## Task 3: Frontend — pantalla `/informe`

**Files:**
- Create: `frontend/src/views/Informe.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/stores/acciones.js`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: `GET /contactos/informe` (Task 2); `acc.cargarEtiquetas()` (catálogo para los selects); `acc.abrirContacto(id, false)`.
- Produces: `cargarInforme(filtros)`; vista `Informe.vue`; ruta `/informe`; ítem "📋 Informe" en el menú.

- [ ] **Step 1: Store action**

En `frontend/src/stores/acciones.js`:

```javascript
    async cargarInforme(filtros = {}) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== '' && v != null) q.set(k, v);
      }
      return apiFetch(`/contactos/informe?${q.toString()}`);
    },
```

- [ ] **Step 2: Route**

En `frontend/src/router/index.js`, añade a `routes`:

```javascript
    { path: '/informe', name: 'informe', component: () => import('../views/Informe.vue'), meta: { requiereAuth: true } },
```

- [ ] **Step 3: Menu item en `Bandeja.vue`**

En el menú desplegable de la cabecera (junto a "📊 Agentes"/"🏷️ Etiquetas"), añade (importa `useRouter` si hace falta, o usa `<router-link>`). Con router programático:

```javascript
// en <script setup> de Bandeja.vue, si no está:
import { useRouter } from 'vue-router';
const router = useRouter();
```
y el ítem del menú:
```html
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; router.push('/informe')">📋 Informe de contactos</button>
```

- [ ] **Step 4: Create `Informe.vue`**

```html
<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';

const router = useRouter();
const acc = useAcciones();

const filtros = ref({ compro: '', origenId: '', interesId: '', estado: '', desde: '', hasta: '', pagina: 0, tam: 25 });
const datos = ref({ total: 0, pagina: 0, tam: 25, contactos: [] });
const catalogo = ref({ origen: [], interes: [] });
const cargando = ref(false);
const error = ref('');

async function cargar(pagina = 0) {
  filtros.value.pagina = pagina;
  cargando.value = true; error.value = '';
  try { datos.value = await acc.cargarInforme(filtros.value); }
  catch (e) { error.value = e.message || 'No se pudo cargar el informe.'; }
  finally { cargando.value = false; }
}

onMounted(async () => {
  try { catalogo.value = await acc.cargarEtiquetas(); } catch { /* selects quedan vacíos */ }
  await cargar(0);
});

const desde = computed(() => datos.value.total === 0 ? 0 : datos.value.pagina * datos.value.tam + 1);
const hasta = computed(() => Math.min((datos.value.pagina + 1) * datos.value.tam, datos.value.total));
const hayPrev = computed(() => datos.value.pagina > 0);
const hayNext = computed(() => (datos.value.pagina + 1) * datos.value.tam < datos.value.total);

const colorCompro = (v) => v === 'si' ? 'text-green-700' : v === 'no' ? 'text-red-700' : v === 'pendiente' ? 'text-amber-700' : 'text-gray-400';
const textoCompro = (v) => v === 'si' ? 'Sí' : v === 'no' ? 'No' : v === 'pendiente' ? 'Pendiente' : '—';
function fecha(v) { return v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }

async function abrir(row) {
  try { await acc.abrirContacto(row.contactoId, false); router.push('/'); }
  catch { error.value = 'No se pudo abrir el chat.'; }
}
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Informe de contactos</div>
    </header>

    <div class="bg-white border-b px-4 py-2 flex flex-wrap items-end gap-2 text-[12px]">
      <label class="flex flex-col">¿Compró?
        <select v-model="filtros.compro" class="border rounded px-2 py-1">
          <option value="">Todos</option><option value="si">Sí</option><option value="no">No</option>
          <option value="pendiente">Pendiente</option><option value="sin">Sin marcar</option>
        </select>
      </label>
      <label class="flex flex-col">Origen
        <select v-model="filtros.origenId" class="border rounded px-2 py-1">
          <option value="">Todos</option>
          <option v-for="e in catalogo.origen" :key="e.id" :value="e.id">{{ e.nombre }}</option>
        </select>
      </label>
      <label class="flex flex-col">Interés
        <select v-model="filtros.interesId" class="border rounded px-2 py-1">
          <option value="">Todos</option>
          <option v-for="e in catalogo.interes" :key="e.id" :value="e.id">{{ e.nombre }}</option>
        </select>
      </label>
      <label class="flex flex-col">Estado
        <select v-model="filtros.estado" class="border rounded px-2 py-1">
          <option value="">Todos</option><option value="nueva">Nueva</option><option value="abierta">Abierta</option>
          <option value="pendiente">Pendiente</option><option value="cerrada">Cerrada</option><option value="sin">Sin chat</option>
        </select>
      </label>
      <label class="flex flex-col">Desde<input type="date" v-model="filtros.desde" class="border rounded px-2 py-1" /></label>
      <label class="flex flex-col">Hasta<input type="date" v-model="filtros.hasta" class="border rounded px-2 py-1" /></label>
      <button class="bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="cargar(0)">Aplicar</button>
    </div>

    <div class="flex-1 overflow-auto p-3">
      <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Cargando…</div>
      <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
      <template v-else>
        <div class="text-[12px] text-gray-500 mb-2">{{ desde }}–{{ hasta }} de {{ datos.total }}</div>
        <table class="w-full bg-white rounded shadow text-[13px]">
          <thead class="text-gray-500 text-[11px] uppercase bg-gray-50">
            <tr>
              <th class="text-left px-3 py-2">Contacto</th><th class="text-left px-3 py-2">Dueño</th>
              <th class="text-left px-3 py-2">¿Compró?</th><th class="text-left px-3 py-2">Origen</th>
              <th class="text-left px-3 py-2">Interés</th><th class="text-left px-3 py-2">Estado</th>
              <th class="text-left px-3 py-2">Última actividad</th><th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in datos.contactos" :key="r.contactoId" class="border-t hover:bg-gray-50">
              <td class="px-3 py-2"><div class="text-gray-800">{{ r.nombre }}</div><div class="text-[11px] text-gray-400">{{ r.telefono }}</div></td>
              <td class="px-3 py-2 text-gray-600">{{ r.agenteDueno || '—' }}</td>
              <td class="px-3 py-2 font-semibold" :class="colorCompro(r.compro)">{{ textoCompro(r.compro) }}</td>
              <td class="px-3 py-2">
                <span v-if="r.origen" class="px-2 py-0.5 rounded-full text-[11px]" :style="{ color: r.origen.color, border: `1px solid ${r.origen.color}` }">{{ r.origen.nombre }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2">
                <span v-for="i in r.intereses" :key="i.nombre" class="px-2 py-0.5 rounded-full text-[11px] mr-1" :style="{ color: i.color, border: `1px solid ${i.color}` }">{{ i.nombre }}</span>
                <span v-if="!r.intereses.length" class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2 capitalize text-gray-600">{{ r.estado || 'sin chat' }}</td>
              <td class="px-3 py-2 text-gray-500 whitespace-nowrap">{{ fecha(r.ultimaActividad) }}</td>
              <td class="px-3 py-2 text-right"><button class="text-marca-oscuro font-semibold" @click="abrir(r)">Abrir ›</button></td>
            </tr>
            <tr v-if="!datos.contactos.length"><td colspan="8" class="text-center text-gray-400 py-6">Sin resultados.</td></tr>
          </tbody>
        </table>
        <div class="flex items-center justify-center gap-3 mt-3 text-[13px]">
          <button :disabled="!hayPrev" class="px-3 py-1 rounded border disabled:opacity-40" @click="cargar(datos.pagina - 1)">‹ Anterior</button>
          <span class="text-gray-500">Página {{ datos.pagina + 1 }}</span>
          <button :disabled="!hayNext" class="px-3 py-1 rounded border disabled:opacity-40" @click="cargar(datos.pagina + 1)">Siguiente ›</button>
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Build + tests**

Run: `npm --prefix frontend run build && npm --prefix frontend test`
Expected: build sin errores; tests existentes en verde.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Informe.vue frontend/src/router/index.js frontend/src/stores/acciones.js frontend/src/views/Bandeja.vue
git commit -m "feat(informe): pantalla /informe con filtros, tabla y paginación"
```

---

## Deploy (tras aprobar e implementar)

Solo código (sin migración):
1. `git pull` + `npm --prefix frontend run build`.
2. `pm2 restart wa-backend`.
3. Verificación en vivo: menú → 📋 Informe; filtrar por ¿compró?/origen/interés/estado/fechas; paginar; "Abrir" un contacto lleva a la bandeja con el chat abierto.

## Fuera de alcance

- Export a Excel/CSV; gráficas; filtro por agente/línea; editar ¿compró? desde la tabla.
