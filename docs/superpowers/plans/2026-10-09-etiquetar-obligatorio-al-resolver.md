# Etiquetar obligatorio (origen+interés) al resolver — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al marcar un chat como resuelto, exigir (popup + candado backend) que tenga al menos una etiqueta de origen y una de interés; si ya las tiene, resolver directo.

**Architecture:** Un candado en `resolver` (backend) rechaza con 409 `etiquetas_requeridas` si faltan. El frontend intercepta el botón ✓: si faltan etiquetas abre un popup que obliga a marcar origen+interés y luego resuelve; si ya están, resuelve directo. Helpers puros en back y front deciden "faltan / están".

**Tech Stack:** Node 20 CommonJS, Express, Sequelize, Vue 3 + Pinia + Vitest, `node:test`.

Spec: `docs/superpowers/specs/2026-10-09-etiquetar-obligatorio-al-resolver-design.md`.

## Global Constraints

- Node 20 CommonJS. Solo tablas `wa_`. Sin migración (etiquetas y su relación ya existen). Sin dependencias nuevas.
- Categorías: `'origen'` y `'interes'` (constante `CATEGORIAS` en `src/services/etiquetas.js`). Etiquetas traen `categoria`.
- "Obligatorio" = al menos una etiqueta de origen **y** una de interés.
- Backend es la garantía (no saltable por API); el popup es la UX. Si ya hay ambas → resolver directo (sin popup).
- No cambia el 409 `sin_asignar` existente ni el cierre (estado CERRADA).
- Test backend: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/<archivo>` (suite completa `test/*.test.js 2>&1 | tail -4`, reporter `ℹ`, confirmar `fail 0`).
- Test frontend: `npm --prefix frontend test` (un archivo: `-- <ruta>`); build `npm --prefix frontend run build`.

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/etiquetas.js` | `faltanEtiquetasObligatorias(etiquetas)` (pura) | Modificar |
| `test/etiquetas-obligatorio.test.js` | test de la pura backend | Crear |
| `src/controllers/conversacionesController.js` | candado en `resolver` | Modificar |
| `frontend/src/utils/etiquetas.js` | `tieneOrigenEInteres(etiquetas)` (pura) | Modificar |
| `frontend/src/utils/etiquetas.test.js` | test de la pura frontend | Modificar |
| `frontend/src/components/PopupEtiquetarResolver.vue` | popup obligatorio | Crear |
| `frontend/src/components/VistaChat.vue` | directo-vs-popup + montaje | Modificar |

---

## Task 1: Candado backend en `resolver`

**Files:**
- Modify: `src/services/etiquetas.js`
- Test: `test/etiquetas-obligatorio.test.js`
- Modify: `src/controllers/conversacionesController.js`

**Interfaces:**
- Produces: `faltanEtiquetasObligatorias(etiquetas) → boolean` (true si NO hay ≥1 origen y ≥1 interés), exportada desde `src/services/etiquetas.js`.
- `resolver` devuelve 409 `{ codigo: 'etiquetas_requeridas' }` si faltan.

- [ ] **Step 1: Escribir el test que falla**

Create `test/etiquetas-obligatorio.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { faltanEtiquetasObligatorias } = require('../src/services/etiquetas');

const org = { id: 1, categoria: 'origen' };
const intr = { id: 2, categoria: 'interes' };

test('faltanEtiquetasObligatorias: sin etiquetas → true', () => {
  assert.equal(faltanEtiquetasObligatorias([]), true);
  assert.equal(faltanEtiquetasObligatorias(null), true);
});
test('faltanEtiquetasObligatorias: solo origen → true', () => {
  assert.equal(faltanEtiquetasObligatorias([org]), true);
});
test('faltanEtiquetasObligatorias: solo interés → true', () => {
  assert.equal(faltanEtiquetasObligatorias([intr]), true);
});
test('faltanEtiquetasObligatorias: origen + interés → false', () => {
  assert.equal(faltanEtiquetasObligatorias([org, intr]), false);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas-obligatorio.test.js`
Expected: FAIL (`faltanEtiquetasObligatorias` no existe).

- [ ] **Step 3: Implementar la pura**

In `src/services/etiquetas.js`, add near the top (after `CATEGORIAS`) the function and export it:

```js
/** Pura: true si a la lista le falta ≥1 origen o ≥1 interés (etiquetado obligatorio al resolver). */
function faltanEtiquetasObligatorias(etiquetas) {
  const list = etiquetas || [];
  const tieneOrigen = list.some((e) => e && e.categoria === CATEGORIAS.ORIGEN);
  const tieneInteres = list.some((e) => e && e.categoria === CATEGORIAS.INTERES);
  return !(tieneOrigen && tieneInteres);
}
```

Add `faltanEtiquetasObligatorias` to `module.exports`.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/etiquetas-obligatorio.test.js`
Expected: PASS.

- [ ] **Step 5: Candado en `resolver`**

In `src/controllers/conversacionesController.js`, in `resolver`, after the `sin_asignar` 409 block and BEFORE the `Conversacion.update`, add:

```js
    const etqs = await etiquetasSvc.etiquetasDeConversacion(conv.id);
    if (etiquetasSvc.faltanEtiquetasObligatorias(etqs)) {
      return res.status(409).json({ error: 'marca una etiqueta de origen y una de interés antes de resolver', codigo: 'etiquetas_requeridas' });
    }
```
(`etiquetasSvc` ya está importado en el archivo, línea 19.)

- [ ] **Step 6: Verificar sintaxis + suite (sin regresiones)**

Run:
```bash
cd "/Users/bortega/Shared/Files From c.localized/apps/mantix/wa" && node --check src/controllers/conversacionesController.js && node --check src/services/etiquetas.js && \
JWT_SECRET=t DB_HOST=x DB_PORT=3306 DB_NAME=x DB_USER=x DB_PASSWORD=x ONEMSG_BASE_URL=https://api.1msg.io ONEMSG_INSTANCE_ID=V ONEMSG_TOKEN=t WEBHOOK_SECRET=x LOG_LEVEL=warn node --test test/*.test.js 2>&1 | tail -4
```
Expected: sintaxis OK; `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/services/etiquetas.js test/etiquetas-obligatorio.test.js src/controllers/conversacionesController.js
git commit -m "feat(resolver): candado backend exige origen e interés antes de resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Helper puro frontend `tieneOrigenEInteres`

**Files:**
- Modify: `frontend/src/utils/etiquetas.js`
- Test: `frontend/src/utils/etiquetas.test.js`

**Interfaces:**
- Produces: `tieneOrigenEInteres(etiquetas) → boolean` (true si hay ≥1 origen y ≥1 interés).

- [ ] **Step 1: Escribir el test que falla**

In `frontend/src/utils/etiquetas.test.js`, add (respeta el estilo del archivo; importa lo nuevo):

```js
import { tieneOrigenEInteres } from './etiquetas';

describe('tieneOrigenEInteres', () => {
  const org = { id: 1, categoria: 'origen' };
  const intr = { id: 2, categoria: 'interes' };
  it('vacío o solo una categoría → false', () => {
    expect(tieneOrigenEInteres([])).toBe(false);
    expect(tieneOrigenEInteres([org])).toBe(false);
    expect(tieneOrigenEInteres([intr])).toBe(false);
  });
  it('origen + interés → true', () => {
    expect(tieneOrigenEInteres([org, intr])).toBe(true);
  });
});
```

(Si el archivo usa `test(...)` en vez de `describe/it`, adáptalo a su estilo.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm --prefix frontend test -- src/utils/etiquetas.test.js`
Expected: FAIL (`tieneOrigenEInteres` no existe).

- [ ] **Step 3: Implementar**

In `frontend/src/utils/etiquetas.js`, add:

```js
// true si la lista tiene al menos una etiqueta de origen y una de interés.
export function tieneOrigenEInteres(etiquetas) {
  const list = etiquetas || [];
  return list.some((e) => e && e.categoria === 'origen') && list.some((e) => e && e.categoria === 'interes');
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm --prefix frontend test -- src/utils/etiquetas.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/etiquetas.js frontend/src/utils/etiquetas.test.js
git commit -m "feat(resolver): helper tieneOrigenEInteres (frontend)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Popup obligatorio + flujo en `VistaChat`

**Files:**
- Create: `frontend/src/components/PopupEtiquetarResolver.vue`
- Modify: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Consumes: `tieneOrigenEInteres` (Task 2); `acc.cargarEtiquetas()`, `acc.alternarEtiqueta(convId, e)`, `acc.resolver(convId)`, `acc.catalogoEtiquetas`, `chat.etiquetas`, `chat.conversacion`, `chat.cerrar()`.

- [ ] **Step 1: Crear el popup**

Create `frontend/src/components/PopupEtiquetarResolver.vue`:

```vue
<script setup>
import { ref, computed, onMounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { tieneOrigenEInteres } from '../utils/etiquetas';

const emit = defineEmits(['cerrar']);
const chat = useChat();
const acc = useAcciones();
const guardando = ref(false);
const error = ref('');

const catalogo = computed(() => acc.catalogoEtiquetas);
const seleccion = computed(() => chat.etiquetas || []);
const completo = computed(() => tieneOrigenEInteres(seleccion.value));
const marcada = (e) => seleccion.value.some((x) => x.id === e.id);

onMounted(() => { acc.cargarEtiquetas(); });

async function alternar(e) {
  try { await acc.alternarEtiqueta(chat.conversacion.id, e); }
  catch { error.value = 'No se pudo etiquetar.'; }
}

async function resolver() {
  if (!completo.value) return;
  error.value = ''; guardando.value = true;
  try { await acc.resolver(chat.conversacion.id); chat.cerrar(); emit('cerrar'); }
  catch (e) { error.value = e.codigo === 'etiquetas_requeridas' ? 'Faltan etiquetas de origen e interés.' : (e.message || 'No se pudo resolver.'); }
  finally { guardando.value = false; }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-md flex flex-col max-h-[85vh]">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Etiquetar antes de resolver</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>
      <div class="p-4 space-y-3 overflow-auto">
        <p class="text-[12px] text-gray-500">Marca una etiqueta de <b>Origen</b> y una de <b>Interés</b> para poder resolver.</p>
        <div>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="e in catalogo.origen" :key="e.id" @click="alternar(e)"
              class="px-2 py-1 rounded-full text-[12px] border"
              :class="marcada(e) ? 'bg-marca text-white border-marca' : 'bg-white text-gray-700 border-gray-300'">{{ e.nombre }}</button>
          </div>
        </div>
        <div>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Interés</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="e in catalogo.interes" :key="e.id" @click="alternar(e)"
              class="px-2 py-1 rounded-full text-[12px] border"
              :class="marcada(e) ? 'bg-marca text-white border-marca' : 'bg-white text-gray-700 border-gray-300'">{{ e.nombre }}</button>
          </div>
        </div>
        <p v-if="error" class="text-[12px] text-red-600">{{ error }}</p>
      </div>
      <div class="border-t px-4 py-3 flex justify-end gap-2">
        <button class="px-3 py-1.5 text-[13px] text-gray-500" @click="emit('cerrar')">Cancelar</button>
        <button :disabled="!completo || guardando" class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px] disabled:opacity-60" @click="resolver">
          {{ guardando ? 'Resolviendo…' : 'Resolver' }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Flujo directo-vs-popup en `VistaChat.vue` — script**

In `frontend/src/components/VistaChat.vue`, add the imports (junto a los otros):

```js
import { tieneOrigenEInteres } from '../utils/etiquetas';
import PopupEtiquetarResolver from './PopupEtiquetarResolver.vue';
```

Add the state (junto a los otros `ref`):

```js
const mostrarPopupResolver = ref(false);
```

Replace the `resolver` function with:

```js
async function resolver() {
  if (!tieneOrigenEInteres(chat.etiquetas)) { mostrarPopupResolver.value = true; return; }
  try {
    await acc.resolver(chat.conversacion.id);
    chat.cerrar();
  } catch (e) {
    if (e && e.codigo === 'etiquetas_requeridas') mostrarPopupResolver.value = true;
    /* otros errores: el chat queda abierto */
  }
}
```

- [ ] **Step 3: Montar el popup en el template**

In `frontend/src/components/VistaChat.vue`, mount the popup inside the component's root (por ejemplo justo antes de cerrar el contenedor raíz del template):

```html
    <PopupEtiquetarResolver v-if="mostrarPopupResolver" @cerrar="mostrarPopupResolver = false" />
```

- [ ] **Step 4: Suite frontend + build**

Run: `npm --prefix frontend test` (todo verde) y `npm --prefix frontend run build` (OK).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PopupEtiquetarResolver.vue frontend/src/components/VistaChat.vue
git commit -m "feat(resolver): popup obligatorio de origen/interés al marcar resuelto

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Despliegue (tras merge)

Backend (controller/servicio) + frontend; sin migración. (El worker no cambia; reiniciar backend basta.)
```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build && pm2 restart wa-backend'
```

**Verificación en vivo (usuario):**
1. Abrir un chat propio **sin etiquetas** y dar ✓ → aparece el popup, "Resolver" deshabilitado.
2. Marcar una de **Origen** y una de **Interés** → se habilita; "Resolver" cierra el chat (pasa a Resueltos).
3. Abrir un chat que **ya** tenga origen+interés y dar ✓ → cierra directo, sin popup.
4. (Candado) Intentar resolver por API sin etiquetas → 409 `etiquetas_requeridas`.

## Self-review

- **Cobertura del spec:** candado backend + pura (T1), pura frontend (T2), popup + flujo directo-vs-popup (T3).
- **Tipos consistentes:** `faltanEtiquetasObligatorias(etiquetas)→bool` (back); `tieneOrigenEInteres(etiquetas)→bool` (front); 409 `codigo: 'etiquetas_requeridas'`; categorías `'origen'`/`'interes'`; usa `cargarEtiquetas`/`alternarEtiqueta`/`resolver` existentes.
- **Sin placeholders:** cada paso trae código real y comando con salida esperada.
