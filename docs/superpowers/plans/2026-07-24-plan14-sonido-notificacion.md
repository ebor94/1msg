# Plan 14 — Sonido de notificación (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducir un sonido cuando llega un mensaje entrante de un chat que NO está abierto, con un botón por usuario para activar/silenciar.

**Architecture:** Store `sonido` (Pinia) que envuelve un `Audio` del `.mp3` incluido en `assets`, con un flag `activado` persistido en `localStorage`. El handler `mensaje:nuevo` del socket lo reproduce cuando `direccion==='in'` y el chat no está abierto. Un botón 🔔/🔕 en el header alterna el estado.

**Tech Stack:** Vue 3/Pinia, HTML5 Audio API. Solo frontend; sin backend ni migración.

## Global Constraints

- Suena SOLO en entrantes (`mensaje.direccion === 'in'`) cuyo chat NO está abierto. Nunca en salientes ni en el chat que se está viendo.
- El alcance ya lo dan los *rooms* del socket: cada agente solo recibe eventos de sus chats + general.
- Config por usuario en `localStorage` (`wa_sonido`, default activado). Sin migración, sin backend.
- Los navegadores bloquean audio hasta una interacción del usuario; `play()` se envuelve en `.catch()` para no lanzar si está bloqueado (ya hubo login, así que normalmente funciona).
- Vue 3 `<script setup>`; sin `console.log`.

## File Structure

- `frontend/src/assets/notificacion.mp3` — **ya está en el repo** (copiado). No hay que crearlo.
- `frontend/src/stores/sonido.js` (crear): store con `activado`, `alternar()`, `reproducir()`.
- `frontend/src/socket/cliente.js` (modificar): reproducir en `mensaje:nuevo`.
- `frontend/src/views/Bandeja.vue` (modificar): botón 🔔/🔕 en el header.

---

### Task 1: Store de sonido + integración socket + botón

**Files:**
- Create: `frontend/src/stores/sonido.js`
- Modify: `frontend/src/socket/cliente.js`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Store `sonido`: state `{ activado }`; acciones `alternar()`, `reproducir()`.

- [ ] **Step 1: Store `frontend/src/stores/sonido.js`**

```js
import { defineStore } from 'pinia';
import notificacion from '../assets/notificacion.mp3';

const CLAVE = 'wa_sonido';
let audio = null;

export const useSonido = defineStore('sonido', {
  state: () => ({ activado: localStorage.getItem(CLAVE) !== '0' }),
  actions: {
    alternar() {
      this.activado = !this.activado;
      localStorage.setItem(CLAVE, this.activado ? '1' : '0');
    },
    reproducir() {
      if (!this.activado) return;
      if (!audio) audio = new Audio(notificacion);
      audio.currentTime = 0;
      // El navegador puede bloquear autoplay hasta una interacción; se ignora el error.
      audio.play().catch(() => {});
    },
  },
});
```

- [ ] **Step 2: Reproducir en el socket**

En `frontend/src/socket/cliente.js`, importar el store y reproducir en `mensaje:nuevo`. Añadir el import:

```js
import { useSonido } from '../stores/sonido';
```

Y en el handler `mensaje:nuevo`, tras calcular `abierta` y actualizar la lista, añadir (el sonido NO depende de que la conversación esté en la lista visible):

```js
    if (item && !abierta && mensaje.direccion === 'in') item.noLeidos = (item.noLeidos || 0) + 1;
    if (!abierta && mensaje.direccion === 'in') useSonido().reproducir();
```

(La primera línea ya existe; añadir solo la segunda, después de ella.)

- [ ] **Step 3: Botón 🔔/🔕 en `frontend/src/views/Bandeja.vue`**

En `<script setup>` importar y usar el store:

```js
import { useSonido } from '../stores/sonido';
const sonido = useSonido();
```

En el header, junto al botón "＋ Contacto" (antes del chip de rol), añadir:

```vue
        <button class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[13px]"
          :title="sonido.activado ? 'Silenciar notificaciones' : 'Activar notificaciones'"
          @click="sonido.alternar()">{{ sonido.activado ? '🔔' : '🔕' }}</button>
```

- [ ] **Step 4: Verificar suite y build**

```
npm --prefix frontend test
npm --prefix frontend run build
```
Expected: verde y build OK (Vite empaqueta el `.mp3` como asset).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assets/notificacion.mp3 frontend/src/stores/sonido.js frontend/src/socket/cliente.js frontend/src/views/Bandeja.vue
git commit -m "feat(frontend): sonido de notificación en entrantes (config por usuario, chat no abierto)"
```

---

### Task 2: Despliegue + prueba real

- [ ] **Step 1: Deploy.** Merge a `main`, push. En el servidor: `git pull`, `npm --prefix frontend run build`, `pm2 restart wa-backend`. `/health` 200.
- [ ] **Step 2: Prueba real.** Con la bandeja abierta (y tras haber hecho algún clic, para desbloquear el audio): (a) desde otro WhatsApp enviar un mensaje a un chat que NO tienes abierto → debe **sonar** y subir el contador de no leídos; (b) tener ese chat abierto y recibir un mensaje → **no** debe sonar; (c) pulsar 🔔 → pasa a 🔕 y ya no suena; recargar la página → el estado 🔕 persiste (localStorage).

---

## Notas de cobertura (Plan 14)

Cubre: sonido en entrantes de chats no abiertos, toggle por usuario persistido, alcance por rooms. **Fuera de alcance:** notificaciones de escritorio del navegador, volumen configurable, sonidos distintos por tipo. El `.mp3` provisto por el usuario ya está en `assets`.
