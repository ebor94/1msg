# Difusiones — Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla admin de Difusiones: un asistente para crear una campaña (elegir plantilla → mapear variables → pegar CSV → vista previa → imagen opcional → iniciar) y una vista de resultados con el embudo en vivo y el detalle por destinatario.

**Architecture:** Vue 3 `<script setup>` + Pinia + Vue Router + Tailwind, consumiendo los endpoints admin ya vivos (`/api/difusiones*`). El backend ya funciona (probado con envío real). Todo admin-only; el patrón es el de `Informe.vue`/`ScorecardAgentes.vue` (vista de pantalla completa + link en el menú).

**Tech Stack:** Vue 3, Pinia, Vue Router, Tailwind, Vitest. `apiFetch` (JSON) para todo salvo la subida de imagen, que va por `fetch` crudo con `FormData` (patrón `enviarMedia`).

## Global Constraints

- Admin-only: el link y la ruta solo para `auth.esAdministrador` (el backend ya exige admin; el front solo oculta).
- `apiFetch(ruta, opts)` antepone `/api`, mete el token, y para 401 borra el token — por eso **no** se usa para subir la imagen (multipart); esa va por `fetch` crudo con header de token y SIN `content-type` (que el navegador ponga el boundary), como `acciones.enviarMedia`.
- Las plantillas ya vienen parseadas de `GET /plantillas` → `acc.plantillas`, cada una con `{ name, cuerpo, variables (nº), tieneImagen, imagenDefault, categoria, language, namespace }`.
- El `mapeo` que espera el backend: `{ telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [ {tipo:'columna', columna} | {tipo:'fijo', valor} ] }` (en orden `{{1}}..{{n}}`).
- Nada de romper el build; correr `npm --prefix frontend test` y `npm --prefix frontend run build`.

## File Structure

- `frontend/src/utils/difusion.js` (crear) — helpers puros (`renderizarCuerpo`, `parsearCsvPreview`, `valorDeVariable`).
- `frontend/src/stores/acciones.js` (modificar) — acciones de difusiones (JSON) + subida de imagen (FormData).
- `frontend/src/views/Difusiones.vue` (crear) — vista de lista + resultados.
- `frontend/src/components/DifusionWizard.vue` (crear) — asistente de creación.
- `frontend/src/router/index.js` (modificar) — ruta `/difusiones`.
- `frontend/src/views/Bandeja.vue` (modificar) — link en el menú (admin).
- `frontend/src/utils/difusion.test.js`, `frontend/src/stores/acciones.difusiones.test.js` (crear) — tests.

---

### Task 1: Utils puros + acciones del store

**Files:**
- Create: `frontend/src/utils/difusion.js`, `frontend/src/utils/difusion.test.js`, `frontend/src/stores/acciones.difusiones.test.js`
- Modify: `frontend/src/stores/acciones.js`

**Interfaces:**
- Consumes: `apiFetch`, `tokenGuardado` de `../api/cliente`.
- Produces (utils):
  - `renderizarCuerpo(cuerpo: string, valores: string[]): string` — reemplaza `{{1}}..{{n}}` por `valores[n-1]` (o `''`).
  - `parsearCsvPreview(texto: string): { cabeceras: string[], primera: object|null }` — cabeceras + primera fila como objeto (para la vista previa).
  - `valorDeVariable(v: {tipo, columna?, valor?}, fila: object): string` — resuelve una variable del mapeo contra una fila.
- Produces (acciones Pinia): `listarDifusiones()`, `crearDifusion(datos)`, `cargarDestinatariosDifusion(id, payload)`, `subirImagenDifusion(id, file)`, `iniciarDifusion(id)`, `cancelarDifusion(id)`, `detalleDifusion(id)`, `destinatariosDifusion(id, params)`.

- [ ] **Step 1: Write the failing test (utils)**

```javascript
// frontend/src/utils/difusion.test.js
import { describe, it, expect } from 'vitest';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable } from './difusion';

describe('difusion utils', () => {
  it('renderizarCuerpo reemplaza {{n}} en orden', () => {
    expect(renderizarCuerpo('Hola {{1}}, debes {{2}}', ['Ana', '$5'])).toBe('Hola Ana, debes $5');
    expect(renderizarCuerpo('Sin vars', [])).toBe('Sin vars');
    expect(renderizarCuerpo('Falta {{2}}', ['x'])).toBe('Falta ');
  });
  it('parsearCsvPreview saca cabeceras y primera fila', () => {
    const r = parsearCsvPreview('CELULAR,NOMBRE\n3001234567,Ana\n3009999999,Beto');
    expect(r.cabeceras).toEqual(['CELULAR', 'NOMBRE']);
    expect(r.primera.NOMBRE).toBe('Ana');
    expect(parsearCsvPreview('').primera).toBe(null);
  });
  it('valorDeVariable resuelve columna y fijo', () => {
    expect(valorDeVariable({ tipo: 'columna', columna: 'NOMBRE' }, { NOMBRE: 'Ana' })).toBe('Ana');
    expect(valorDeVariable({ tipo: 'fijo', valor: '$5' }, { NOMBRE: 'Ana' })).toBe('$5');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend test -- difusion.test`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Write the utils**

```javascript
// frontend/src/utils/difusion.js
// Helpers puros para el asistente de difusiones (vista previa + mapeo). Sin red.

export function renderizarCuerpo(cuerpo, valores) {
  return String(cuerpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? '');
}

export function parsearCsvPreview(texto) {
  const lineas = String(texto || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lineas.length) return { cabeceras: [], primera: null };
  const cabeceras = lineas[0].split(',').map((c) => c.trim());
  let primera = null;
  if (lineas.length > 1) {
    const celdas = lineas[1].split(',');
    primera = {};
    cabeceras.forEach((c, i) => { primera[c] = (celdas[i] ?? '').trim(); });
  }
  return { cabeceras, primera };
}

export function valorDeVariable(v, fila) {
  if (v.tipo === 'fijo') return String(v.valor ?? '');
  return String((fila && fila[v.columna]) ?? '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend test -- difusion.test`
Expected: PASS (3/3).

- [ ] **Step 5: Write the failing test (acciones)**

```javascript
// frontend/src/stores/acciones.difusiones.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({
  apiFetch: (...a) => fetchMock(...a),
  tokenGuardado: () => 't',
}));

import { useAcciones } from './acciones';

describe('acciones difusiones', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('listarDifusiones pega al endpoint', async () => {
    fetchMock.mockResolvedValue({ difusiones: [{ id: 1 }] });
    const acc = useAcciones();
    const r = await acc.listarDifusiones();
    expect(fetchMock).toHaveBeenCalledWith('/difusiones');
    expect(r).toEqual([{ id: 1 }]);
  });
  it('crearDifusion hace POST con el cuerpo', async () => {
    fetchMock.mockResolvedValue({ difusion: { id: 5 } });
    const acc = useAcciones();
    const r = await acc.crearDifusion({ nombre: 'X', plantilla: 'p' });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones', { method: 'POST', body: JSON.stringify({ nombre: 'X', plantilla: 'p' }) });
    expect(r.id).toBe(5);
  });
  it('cargarDestinatariosDifusion hace POST del texto+mapeo', async () => {
    fetchMock.mockResolvedValue({ total: 1, pendientes: 1, omitidos: [] });
    const acc = useAcciones();
    await acc.cargarDestinatariosDifusion(5, { texto: 'a', mapeo: { telefono: 'CELULAR' } });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/destinatarios', { method: 'POST', body: JSON.stringify({ texto: 'a', mapeo: { telefono: 'CELULAR' } }) });
  });
  it('iniciarDifusion y cancelarDifusion pegan a sus rutas', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const acc = useAcciones();
    await acc.iniciarDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/iniciar', { method: 'POST' });
    await acc.cancelarDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/cancelar', { method: 'POST' });
  });
  it('detalleDifusion y destinatariosDifusion', async () => {
    fetchMock.mockResolvedValue({ embudo: {}, filas: [] });
    const acc = useAcciones();
    await acc.detalleDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5');
    await acc.destinatariosDifusion(5, { estado: 'fallido', pagina: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/destinatarios?estado=fallido&pagina=2');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm --prefix frontend test -- acciones.difusiones`
Expected: FAIL (acciones no existen).

- [ ] **Step 7: Add the actions** — dentro del objeto `actions` de `useAcciones` (junto a `cargarScorecard`). `tokenGuardado` ya está importado en el archivo.

```javascript
    async listarDifusiones() {
      return (await apiFetch('/difusiones')).difusiones;
    },
    async crearDifusion(datos) {
      return (await apiFetch('/difusiones', { method: 'POST', body: JSON.stringify(datos) })).difusion;
    },
    async cargarDestinatariosDifusion(id, payload) {
      return apiFetch(`/difusiones/${id}/destinatarios`, { method: 'POST', body: JSON.stringify(payload) });
    },
    async subirImagenDifusion(id, file) {
      const fd = new FormData();
      fd.append('imagen', file);
      const token = tokenGuardado();
      const resp = await fetch(`/api/difusiones/${id}/imagen`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let cuerpo = null;
      try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }
      if (!resp.ok) { const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`); e.status = resp.status; throw e; }
      return cuerpo;
    },
    async iniciarDifusion(id) {
      return apiFetch(`/difusiones/${id}/iniciar`, { method: 'POST' });
    },
    async cancelarDifusion(id) {
      return apiFetch(`/difusiones/${id}/cancelar`, { method: 'POST' });
    },
    async detalleDifusion(id) {
      return apiFetch(`/difusiones/${id}`);
    },
    async destinatariosDifusion(id, { estado, pagina = 0 } = {}) {
      const q = new URLSearchParams();
      if (estado) q.set('estado', estado);
      q.set('pagina', String(pagina));
      return apiFetch(`/difusiones/${id}/destinatarios?${q.toString()}`);
    },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm --prefix frontend test -- difusion.test acciones.difusiones`
Expected: PASS (utils 3/3 + acciones 5/5).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/utils/difusion.js frontend/src/utils/difusion.test.js frontend/src/stores/acciones.js frontend/src/stores/acciones.difusiones.test.js
git commit -m "feat(difusiones front): utils de preview + acciones del store"
```

---

### Task 2: Asistente de creación `DifusionWizard.vue`

Modal-asistente que crea la campaña de punta a punta. Emite `creada` al terminar (para que la vista refresque) y `cerrar`.

**Files:**
- Create: `frontend/src/components/DifusionWizard.vue`

**Interfaces:**
- Consumes: `acc.plantillas` + `acc.cargarPlantillas`; `acc.crearDifusion`, `acc.subirImagenDifusion`, `acc.cargarDestinatariosDifusion`, `acc.iniciarDifusion`; utils `renderizarCuerpo`, `parsearCsvPreview`, `valorDeVariable`.
- Produces: componente `<DifusionWizard @creada="..." @cerrar="..." />`.

- [ ] **Step 1: Write the component**

```vue
<!-- frontend/src/components/DifusionWizard.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAcciones } from '../stores/acciones';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable } from '../utils/difusion';

const emit = defineEmits(['creada', 'cerrar']);
const acc = useAcciones();

const nombre = ref('');
const plantillaNombre = ref('');
const mapeo = ref({ telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [] });
const csvTexto = ref('');
const imagenFile = ref(null);
const guardando = ref(false);
const error = ref('');
const resumen = ref(null); // { total, pendientes, omitidos } tras cargar
const difusionId = ref(null);

onMounted(() => { if (!acc.plantillas.length) acc.cargarPlantillas(); });

const plantilla = computed(() => acc.plantillas.find((p) => p.name === plantillaNombre.value) || null);

function elegirPlantilla() {
  const p = plantilla.value;
  mapeo.value.variables = p ? Array.from({ length: p.variables }, () => ({ tipo: 'columna', columna: '', valor: '' })) : [];
}

const preview = computed(() => {
  const p = plantilla.value;
  if (!p) return '';
  const { primera } = parsearCsvPreview(csvTexto.value);
  const valores = mapeo.value.variables.map((v) => valorDeVariable(v, primera || {}));
  return renderizarCuerpo(p.cuerpo, valores);
});

// Columnas que el CSV debe traer, según el mapeo.
const columnasReq = computed(() => {
  const cols = [mapeo.value.telefono, mapeo.value.agente];
  mapeo.value.variables.forEach((v) => { if (v.tipo === 'columna' && v.columna) cols.push(v.columna); });
  return [...new Set(cols)];
});

// mapeo listo para el backend (columna|fijo).
function mapeoBackend() {
  return {
    telefono: mapeo.value.telefono,
    agente: mapeo.value.agente,
    variables: mapeo.value.variables.map((v) => (v.tipo === 'fijo' ? { tipo: 'fijo', valor: v.valor } : { tipo: 'columna', columna: v.columna })),
  };
}

async function crearYCargar() {
  error.value = ''; guardando.value = true;
  try {
    const dif = await acc.crearDifusion({ nombre: nombre.value, plantilla: plantillaNombre.value });
    difusionId.value = dif.id;
    if (plantilla.value?.tieneImagen && imagenFile.value) {
      await acc.subirImagenDifusion(dif.id, imagenFile.value);
    }
    resumen.value = await acc.cargarDestinatariosDifusion(dif.id, { texto: csvTexto.value, mapeo: mapeoBackend() });
  } catch (e) {
    error.value = e.message || 'No se pudo crear la campaña.';
  } finally {
    guardando.value = false;
  }
}

async function iniciar() {
  error.value = ''; guardando.value = true;
  try {
    await acc.iniciarDifusion(difusionId.value);
    emit('creada');
    emit('cerrar');
  } catch (e) {
    error.value = e.message || 'No se pudo iniciar.';
  } finally {
    guardando.value = false;
  }
}

function onArchivo(ev) { imagenFile.value = ev.target.files?.[0] || null; }
const puedeCargar = computed(() => nombre.value.trim() && plantillaNombre.value && csvTexto.value.trim());
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Nueva difusión</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>

      <div class="overflow-auto p-4 space-y-4 text-[13px]">
        <!-- Paso 1: datos -->
        <div>
          <label class="block text-[11px] text-gray-400 uppercase mb-1">Nombre de la campaña</label>
          <input v-model="nombre" class="w-full border rounded px-2 py-1.5" placeholder="Ej. Mora agosto" />
        </div>
        <div>
          <label class="block text-[11px] text-gray-400 uppercase mb-1">Plantilla</label>
          <select v-model="plantillaNombre" @change="elegirPlantilla" class="w-full border rounded px-2 py-1.5">
            <option value="">Seleccione…</option>
            <option v-for="p in acc.plantillas" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </div>

        <template v-if="plantilla">
          <div class="bg-gray-50 border rounded p-2 text-[12px] text-gray-600 whitespace-pre-wrap">{{ plantilla.cuerpo }}</div>

          <!-- Paso 2: mapeo de variables -->
          <div v-if="plantilla.variables" class="space-y-2">
            <div class="text-[11px] text-gray-400 uppercase">Variables</div>
            <div v-for="(v, i) in mapeo.variables" :key="i" class="flex items-center gap-2">
              <span class="text-gray-500 w-10">{{ '{' + '{' + (i + 1) + '}' + '}' }}</span><!-- literal {{n}}: sin '}}' en el fuente (rompe el tokenizer de Vue) -->
              <select v-model="v.tipo" class="border rounded px-2 py-1">
                <option value="columna">Columna CSV</option>
                <option value="fijo">Valor fijo</option>
              </select>
              <input v-if="v.tipo === 'columna'" v-model="v.columna" placeholder="Nombre de columna (ej. NOMBRE)" class="flex-1 border rounded px-2 py-1" />
              <input v-else v-model="v.valor" placeholder="Valor para todos" class="flex-1 border rounded px-2 py-1" />
            </div>
          </div>

          <!-- Imagen si la plantilla la lleva -->
          <div v-if="plantilla.tieneImagen">
            <label class="block text-[11px] text-gray-400 uppercase mb-1">Imagen del encabezado (opcional; si no, usa la de la plantilla)</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" @change="onArchivo" class="text-[12px]" />
          </div>

          <!-- Paso 3: CSV -->
          <div>
            <label class="block text-[11px] text-gray-400 uppercase mb-1">Destinatarios (CSV)</label>
            <div class="text-[11px] text-gray-400 mb-1">Columnas requeridas: <b>{{ columnasReq.join(', ') }}</b></div>
            <textarea v-model="csvTexto" rows="5" class="w-full border rounded px-2 py-1.5 font-mono text-[12px]"
              placeholder="CELULAR,NOMBRE,AGENTE_ID&#10;573001234567,Ana,5"></textarea>
          </div>

          <!-- Vista previa -->
          <div v-if="preview" class="bg-green-50 border border-green-100 rounded p-2">
            <div class="text-[11px] text-gray-400 uppercase mb-1">Vista previa (primera fila)</div>
            <div class="text-[12.5px] text-gray-800 whitespace-pre-wrap">{{ preview }}</div>
          </div>
        </template>

        <!-- Resumen tras cargar -->
        <div v-if="resumen" class="border rounded p-3 bg-gray-50">
          <div class="text-[12px]"><b>{{ resumen.pendientes }}</b> destinatarios listos de {{ resumen.total }}.
            <span v-if="resumen.omitidos.length" class="text-amber-600">{{ resumen.omitidos.length }} omitidos.</span>
          </div>
          <ul v-if="resumen.omitidos.length" class="text-[11px] text-amber-700 mt-1 max-h-24 overflow-auto">
            <li v-for="(o, i) in resumen.omitidos" :key="i">{{ o.telefono }} — {{ o.motivo }}</li>
          </ul>
        </div>

        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>

      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button v-if="!resumen" :disabled="!puedeCargar || guardando"
          class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="crearYCargar">
          {{ guardando ? 'Cargando…' : 'Cargar destinatarios' }}
        </button>
        <button v-else :disabled="guardando || resumen.pendientes === 0"
          class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="iniciar">
          {{ guardando ? 'Iniciando…' : `Iniciar envío (${resumen.pendientes})` }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify build compiles**

Run: `npm --prefix frontend run build`
Expected: build limpio (el componente compila; aún no está enrutado, se integra en Task 3).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DifusionWizard.vue
git commit -m "feat(difusiones front): asistente de creación de campañas"
```

---

### Task 3: Vista de resultados `/difusiones` + ruta + menú

Lista de campañas; al abrir una, el embudo en vivo + detalle por destinatario. Botón "Nueva difusión" abre el wizard.

**Files:**
- Create: `frontend/src/views/Difusiones.vue`
- Modify: `frontend/src/router/index.js`, `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: `acc.listarDifusiones`, `acc.detalleDifusion`, `acc.destinatariosDifusion`, `acc.cancelarDifusion`; `DifusionWizard`.

- [ ] **Step 1: Write the view**

```vue
<!-- frontend/src/views/Difusiones.vue -->
<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAcciones } from '../stores/acciones';
import DifusionWizard from '../components/DifusionWizard.vue';

const router = useRouter();
const acc = useAcciones();

const campanas = ref([]);
const sel = ref(null);          // detalle { difusion, embudo }
const destinatarios = ref({ total: 0, filas: [] });
const cargando = ref(false);
const error = ref('');
const mostrarWizard = ref(false);
let timer = null;

async function cargarLista() {
  cargando.value = true; error.value = '';
  try { campanas.value = await acc.listarDifusiones(); }
  catch (e) { error.value = e.message || 'No se pudieron cargar las campañas.'; }
  finally { cargando.value = false; }
}
async function abrir(id) {
  try {
    sel.value = await acc.detalleDifusion(id);
    destinatarios.value = await acc.destinatariosDifusion(id, {});
  } catch (e) { error.value = e.message || 'No se pudo abrir la campaña.'; }
}
async function refrescarSel() {
  if (sel.value?.difusion?.estado === 'enviando') {
    try { sel.value = await acc.detalleDifusion(sel.value.difusion.id); await cargarLista(); } catch { /* silencioso */ }
  }
}
async function cancelar(id) {
  try { await acc.cancelarDifusion(id); await cargarLista(); if (sel.value?.difusion?.id === id) await abrir(id); }
  catch (e) { error.value = e.message || 'No se pudo cancelar.'; }
}

onMounted(() => { cargarLista(); timer = setInterval(refrescarSel, 8000); });
onUnmounted(() => { if (timer) clearInterval(timer); });

function tras() { mostrarWizard.value = false; cargarLista(); }
const pct = (n, total) => (total ? Math.round((Number(n) || 0) * 100 / total) : 0);
const COLOR_ESTADO = { borrador: 'text-gray-500', enviando: 'text-blue-600', finalizada: 'text-green-600', cancelada: 'text-red-500' };
</script>

<template>
  <div class="h-full flex flex-col bg-gray-50 overflow-auto">
    <header class="bg-marca-oscuro text-white flex items-center gap-3 px-4 py-2.5 sticky top-0 z-10">
      <button class="text-white/80 hover:text-white text-sm" @click="router.push('/')">‹ Volver</button>
      <div class="font-bold">Difusiones</div>
      <button class="ml-auto bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1 text-[13px]" @click="mostrarWizard = true">＋ Nueva difusión</button>
    </header>

    <div class="p-4 grid md:grid-cols-2 gap-4">
      <!-- Lista -->
      <section>
        <div class="text-[13px] font-semibold text-gray-600 mb-2">Campañas</div>
        <p v-if="error" class="text-[12px] text-red-600 mb-2">{{ error }}</p>
        <div v-if="cargando" class="text-[12px] text-gray-400">Cargando…</div>
        <div v-for="c in campanas" :key="c.id" @click="abrir(c.id)"
          class="bg-white border rounded-lg p-3 mb-2 cursor-pointer hover:bg-gray-50"
          :class="sel && sel.difusion.id === c.id ? 'ring-2 ring-marca' : ''">
          <div class="flex justify-between items-center">
            <b class="text-gray-800 text-[13px]">{{ c.nombre }}</b>
            <span class="text-[11px] font-semibold capitalize" :class="COLOR_ESTADO[c.estado]">{{ c.estado }}</span>
          </div>
          <div class="text-[11px] text-gray-400">{{ c.plantilla }} · {{ c.enviados || 0 }}/{{ c.total || 0 }} enviados</div>
        </div>
        <div v-if="!cargando && !campanas.length" class="text-[12px] text-gray-400">Aún no hay campañas.</div>
      </section>

      <!-- Detalle -->
      <section v-if="sel" class="bg-white border rounded-lg p-4">
        <div class="flex justify-between items-start mb-3">
          <div>
            <b class="text-gray-800">{{ sel.difusion.nombre }}</b>
            <div class="text-[11px] text-gray-400">{{ sel.difusion.plantillaNombre }}</div>
          </div>
          <button v-if="sel.difusion.estado === 'enviando'" @click="cancelar(sel.difusion.id)"
            class="text-[12px] text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50">Cancelar</button>
        </div>

        <!-- Embudo -->
        <div class="grid grid-cols-3 gap-2 text-center mb-3">
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-gray-800">{{ sel.embudo.total }}</div><div class="text-[10px] text-gray-400 uppercase">Total</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-gray-800">{{ sel.embudo.enviados }}</div><div class="text-[10px] text-gray-400 uppercase">Enviados</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-lg font-bold text-green-600">{{ sel.embudo.leidos }}</div><div class="text-[10px] text-gray-400 uppercase">Leídos</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-gray-700">{{ sel.embudo.entregados }}</div><div class="text-[10px] text-gray-400 uppercase">Entregados</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-amber-600">{{ sel.embudo.omitidos }}</div><div class="text-[10px] text-gray-400 uppercase">Omitidos</div></div>
          <div class="bg-gray-50 rounded p-2"><div class="text-sm font-bold text-red-600">{{ sel.embudo.fallidos }}</div><div class="text-[10px] text-gray-400 uppercase">Fallidos</div></div>
        </div>
        <div class="text-[12px] text-gray-600 mb-2">Respondidos: <b>{{ sel.embudo.respondidos }}</b>
          <span v-if="sel.embudo.total"> · lectura {{ pct(sel.embudo.leidos, sel.embudo.total) }}%</span>
        </div>
        <div v-if="sel.embudo.fallidosPorCodigo && sel.embudo.fallidosPorCodigo.length" class="text-[11px] text-gray-500 mb-3">
          Fallidos por código: <span v-for="f in sel.embudo.fallidosPorCodigo" :key="f.codigo">{{ f.codigo }} ({{ f.n }}) </span>
        </div>

        <!-- Detalle por destinatario -->
        <div class="text-[11px] text-gray-400 uppercase mb-1">Destinatarios ({{ destinatarios.total }})</div>
        <div class="max-h-64 overflow-auto border rounded">
          <table class="w-full text-[12px]">
            <tbody>
              <tr v-for="d in destinatarios.filas" :key="d.id" class="border-b border-gray-100">
                <td class="px-2 py-1 text-gray-700">{{ (d.parametros && d.parametros[0]) || '—' }}</td>
                <td class="px-2 py-1 capitalize" :class="d.estado === 'fallido' ? 'text-red-600' : d.estado === 'omitido' ? 'text-amber-600' : 'text-gray-600'">{{ d.estado }}</td>
                <td class="px-2 py-1 text-gray-400 text-right">{{ d.errorCodigo || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section v-else class="text-[12px] text-gray-400 grid place-items-center">Selecciona una campaña para ver su resultado.</section>
    </div>

    <DifusionWizard v-if="mostrarWizard" @creada="tras" @cerrar="mostrarWizard = false" />
  </div>
</template>
```

- [ ] **Step 2: Add the route** — en `frontend/src/router/index.js`, tras la línea de `/seguimiento`:

```javascript
    { path: '/difusiones', name: 'difusiones', component: () => import('../views/Difusiones.vue'), meta: { requiereAuth: true } },
```

- [ ] **Step 3: Add the menu link** — en `frontend/src/views/Bandeja.vue`, en el desplegable junto a los otros ítems admin (p. ej. tras "📈 Seguimiento de agentes"):

```html
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; router.push('/difusiones')">📣 Difusiones</button>
```

- [ ] **Step 4: Verify tests + build**

Run: `npm --prefix frontend test`
Expected: PASS (los previos + difusion utils/acciones).
Run: `npm --prefix frontend run build`
Expected: build limpio.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Difusiones.vue frontend/src/router/index.js frontend/src/views/Bandeja.vue
git commit -m "feat(difusiones front): vista de resultados (embudo + detalle) + ruta y menú"
```

---

## Verificación en vivo (tras completar)

Deploy: `git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend` (sin migración; el worker no cambia). Como admin en `wa.losolivoscucuta.com`:
1. Menú → 📣 Difusiones → "Nueva difusión": nombre + `recordatorio_de_mora` → mapear `{{1}}`=NOMBRE, `{{2}}`=Valor_Mora → pegar 1–2 filas de CSV → ver la vista previa → "Cargar destinatarios" → ver el resumen (pendientes/omitidos) → "Iniciar envío".
2. El detalle muestra el embudo; mientras está `enviando` se refresca solo cada 8 s. Verificar que enviados/entregados/leídos suben, y que un contacto existente NO se duplica (usa el mismo del sistema).
3. Un asesor no ve el ítem del menú; si entra a `/difusiones` la API responde 403.

## Notas

- Sin cambios de backend ni migración: consume los endpoints ya vivos.
- El detalle por destinatario muestra el 1er parámetro (normalmente el nombre) + estado + código de error; el teléfono/nombre completo requeriría enriquecer la query `destinatarios` con el contacto (follow-up).
- La imagen sube por `fetch`+`FormData` (no `apiFetch`, que fuerza JSON).
