# Plan 12 — Scroll infinito de la bandeja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la lista de conversaciones cargue más al hacer scroll (paginación de 25), para que un agente con muchos chats pueda verlos todos sin cargarlos de golpe.

**Architecture:** El backend ya pagina (`listar({pagina, tam:25})` devuelve `{total, pagina, conversaciones}`). Este plan es frontend: el store `conversaciones` acumula páginas (`cargarMas`) y `ListaConversaciones` dispara la carga al acercarse al fondo. `cargar` (fresh) resetea la paginación.

**Tech Stack:** Vue 3/Pinia. Solo frontend; sin backend ni migración.

## Global Constraints

- Reutiliza la paginación existente del backend (`?pagina=N`); respeta el orden por bandeja (mías/todos DESC, general ASC) y el filtro `?noLeidos=1` (Plan 17).
- Al **agregar** una página se de-duplica por `id` (el socket puede haber movido ítems entre cargas).
- `cargar` (cambiar de pestaña, alternar filtro, reconexión de socket) resetea a la página 0.
- Vue 3 `<script setup>`; sin `console.log`.

## File Structure

- `frontend/src/stores/conversaciones.js` (modificar): `pagina`/`total`/`cargandoMas` + `cargarMas`.
- `frontend/src/components/ListaConversaciones.vue` (modificar): scroll handler + indicador.

---

### Task 1: Store — paginación acumulativa

**Files:**
- Modify: `frontend/src/stores/conversaciones.js`

**Interfaces:**
- State: `pagina`, `total`, `cargandoMas`. Getter/derivado `hayMas` = `items.length < total`.
- `cargarMas()`: carga la siguiente página y la agrega (dedup por id).

- [ ] **Step 1: Reescribir el store `frontend/src/stores/conversaciones.js`**

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useConversaciones = defineStore('conversaciones', {
  state: () => ({
    bandeja: 'mias',
    items: [],
    total: 0,
    pagina: 0,
    cargando: false,
    cargandoMas: false,
    error: '',
    soloNoLeidos: false,
  }),
  getters: {
    hayMas: (s) => s.items.length < s.total,
  },
  actions: {
    _url(pagina) {
      let url = `/conversaciones?bandeja=${this.bandeja}&pagina=${pagina}`;
      if (this.soloNoLeidos) url += '&noLeidos=1';
      return url;
    },
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      this.pagina = 0;
      try {
        const r = await apiFetch(this._url(0));
        this.items = r.conversaciones;
        this.total = r.total;
      } catch (e) {
        this.error = 'No se pudo cargar la bandeja.';
        this.items = [];
        this.total = 0;
      } finally {
        this.cargando = false;
      }
    },
    async cargarMas() {
      if (this.cargandoMas || !this.hayMas) return;
      this.cargandoMas = true;
      const bandeja = this.bandeja;
      try {
        const r = await apiFetch(this._url(this.pagina + 1));
        // Descartar si cambió la bandeja mientras estaba en vuelo.
        if (this.bandeja !== bandeja) return;
        this.pagina += 1;
        this.total = r.total;
        const vistos = new Set(this.items.map((c) => c.id));
        const nuevos = r.conversaciones.filter((c) => !vistos.has(c.id));
        this.items = [...this.items, ...nuevos];
      } catch {
        /* silencioso: se puede reintentar al seguir scrolleando */
      } finally {
        if (this.bandeja === bandeja) this.cargandoMas = false;
      }
    },
    cambiarBandeja(b) {
      if (b !== this.bandeja) this.cargar(b);
    },
    alternarNoLeidos() {
      this.soloNoLeidos = !this.soloNoLeidos;
      this.cargar();
    },
  },
});
```

- [ ] **Step 2: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK. (Si hay un test del store `conversaciones` que asumía el shape viejo, ajústalo mínimamente para el nuevo `{ total, conversaciones }`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/conversaciones.js
git commit -m "feat(bandeja): paginación acumulativa en el store (cargarMas + total/hayMas)"
```

---

### Task 2: ListaConversaciones — scroll infinito

**Files:**
- Modify: `frontend/src/components/ListaConversaciones.vue`

- [ ] **Step 1: Scroll handler + indicador**

En `<script setup>` (el componente ya tiene `conv = useConversaciones()`), añadir:

```js
function onScrollLista(e) {
  const el = e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) conv.cargarMas();
}
```

En el template, en el contenedor de la lista normal (el `div` con `flex-1 overflow-auto` que envuelve los `ItemConversacion`, dentro del bloque `<template v-else>` que NO es búsqueda), añadir `@scroll="onScrollLista"` y un indicador al final:

```vue
      <div class="flex-1 overflow-auto" @scroll="onScrollLista">
        <div v-if="conv.cargando" class="p-4 text-center text-gray-400 text-sm">Cargando…</div>
        <div v-else-if="conv.error" class="p-4 text-center text-red-500 text-sm">{{ conv.error }}</div>
        <div v-else-if="!conv.items.length" class="p-4 text-center text-gray-400 text-sm">Sin conversaciones.</div>
        <ItemConversacion v-for="c in conv.items" :key="c.id" :conversacion="c" />
        <div v-if="conv.cargandoMas" class="p-2 text-center text-gray-400 text-[12px]">Cargando más…</div>
      </div>
```

(Ajustar al markup real del contenedor de la lista sin romper las pestañas ni el buscador; el cambio clave es `@scroll="onScrollLista"` y el indicador `cargandoMas`.)

- [ ] **Step 2: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ListaConversaciones.vue
git commit -m "feat(frontend): scroll infinito en la lista de la bandeja"
```

---

### Task 3: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 2: Prueba real.** En una bandeja con más de 25 conversaciones (p. ej. General, o un admin en Todos): hacer scroll hasta el fondo → aparecen más (indicador "Cargando más…") hasta agotar; el contador no duplica ítems. Verificar que cambiar de pestaña y togglear "No leídos" reinicia la lista desde el principio, y que el buscador sigue intacto.

---

## Notas de cobertura (Plan 12)

Cubre: scroll infinito acumulativo sobre la paginación ya existente del backend, con dedup por id y reinicio al cambiar de bandeja/filtro. **Fuera de alcance:** virtualización de la lista (para decenas de miles), aparición en vivo de conversaciones nuevas fuera de la página cargada (comportamiento preexistente; se ven al recargar).
