# Plan 19 — Filtro por asesor en "Todos" (admins) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un administrador, en la pestaña "Todos", pueda filtrar la lista por un asesor concreto para ver los chats (y con "No leídos", los pendientes) de cada agente.

**Architecture:** El backend YA soporta `GET /conversaciones?bandeja=todos&agente=X` (`construirFiltro` aplica `agenteFiltro` solo en "todos", y solo admins pueden usar "todos"). Este plan es frontend: el store `conversaciones` lleva `agenteFiltro` y lo incluye en el query; `ListaConversaciones` muestra un `<select>` de asesores cuando la bandeja es "todos".

**Tech Stack:** Vue 3/Pinia. Solo frontend; sin backend ni migración.

## Global Constraints

- El filtro por asesor SOLO aplica/aparece en la pestaña "Todos" (admin). El backend ignora `agente` fuera de "todos" y rechaza "todos" a no-admins (ya existente).
- Se compone con el filtro `noLeidos` (Plan 17) y con la paginación/scroll (Plan 12): al cambiar el asesor se recarga desde la página 0.
- Vue 3 `<script setup>`; sin `console.log`.

## File Structure

- `frontend/src/stores/conversaciones.js` (modificar): `agenteFiltro` + `_url` + `setAgenteFiltro`.
- `frontend/src/components/ListaConversaciones.vue` (modificar): `<select>` de asesores en "Todos".

---

### Task 1: Store + selector de asesor

**Files:**
- Modify: `frontend/src/stores/conversaciones.js`
- Modify: `frontend/src/components/ListaConversaciones.vue`

**Interfaces:**
- Store: `agenteFiltro` (state), `setAgenteFiltro(id)` (set + recarga).

- [ ] **Step 1: Store — `agenteFiltro` en el query**

En `frontend/src/stores/conversaciones.js`:
- Añadir `agenteFiltro: null` al `state`.
- En `_url(pagina)`, incluir el filtro de asesor SOLO en "todos":

```js
    _url(pagina) {
      let url = `/conversaciones?bandeja=${this.bandeja}&pagina=${pagina}`;
      if (this.soloNoLeidos) url += '&noLeidos=1';
      if (this.bandeja === 'todos' && this.agenteFiltro) url += `&agente=${this.agenteFiltro}`;
      return url;
    },
```

- Añadir la acción (set + recarga desde página 0 vía `cargar`):

```js
    setAgenteFiltro(id) {
      this.agenteFiltro = id || null;
      this.cargar();
    },
```

- En `cambiarBandeja`, al salir de "todos" limpiar el filtro para no arrastrarlo:

```js
    cambiarBandeja(b) {
      if (b === this.bandeja) return;
      if (b !== 'todos') this.agenteFiltro = null;
      this.cargar(b);
    },
```

- [ ] **Step 2: `ListaConversaciones.vue` — `<select>` de asesores en "Todos"**

El componente ya usa `useAcciones` (`acc`) y `useAuth` (`auth`). Asegurar que los agentes estén cargados (para el `<select>`): en `onMounted`, si es admin, `acc.cargarAgentes()` (o siempre; es barato). Añadir DEBAJO de la fila de pestañas (dentro del bloque `<template v-else>` de lista normal), y SOLO cuando la bandeja es "todos":

```vue
      <div v-if="conv.bandeja === 'todos'" class="px-2.5 pb-1">
        <select :value="conv.agenteFiltro || ''" @change="conv.setAgenteFiltro($event.target.value ? Number($event.target.value) : null)"
          class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
          <option value="">Todos los agentes</option>
          <option v-for="a in acc.agentes" :key="a.id" :value="a.id">{{ a.nombre }}</option>
        </select>
      </div>
```

En `onMounted`, junto a `conv.cargar('mias')`, añadir la carga de agentes:

```js
onMounted(() => { conv.cargar('mias'); acc.cargarAgentes(); });
```

- [ ] **Step 3: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK. (Si un test del store `conversaciones` fija el shape, ajústalo mínimamente.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/conversaciones.js frontend/src/components/ListaConversaciones.vue
git commit -m "feat(bandeja): filtro por asesor en la pestaña Todos (admins)"
```

---

### Task 2: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 2: Prueba real (como admin, p. ej. bortega/ssuarez).** (a) Ir a la pestaña **Todos** → aparece el desplegable de asesores; elegir uno → la lista muestra solo los chats de ese asesor; (b) activar **No leídos** → solo los pendientes (no leídos) de ese asesor; (c) elegir "Todos los agentes" → vuelven todos; (d) cambiar a Míos/General → el filtro de asesor desaparece y no se arrastra. Verificar que un **asesor** (no admin) no ve la pestaña Todos ni el selector.

---

## Notas de cobertura (Plan 19)

Cubre: filtro por asesor en "Todos" (admin), combinable con "No leídos" (pendientes por agente) y con el scroll infinito. Backend ya soportaba `?agente=`. **Fuera de alcance:** métricas/conteos por agente, filtro por asesor en Míos/General (no aplica).
