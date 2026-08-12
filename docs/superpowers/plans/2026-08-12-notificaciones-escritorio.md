# Notificación de escritorio para entrantes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar una notificación de escritorio del navegador (además del sonido) cuando llega un mensaje entrante de un chat no abierto y la bandeja no está enfocada, con contacto + vista previa; clic abre el chat. Más un contador de respaldo en el título de la pestaña.

**Architecture:** Solo frontend (Vue 3 + Pinia). Un store `notificaciones` (preferencia en localStorage, pide permiso al navegador, crea `new Notification`), un helper puro de vista previa, un módulo de contador en el título, un toggle 🖥️ en la cabecera y el enganche en el handler `mensaje:nuevo` del socket (junto al sonido existente).

**Tech Stack:** Vue 3, Pinia, Vitest (jsdom), Web Notification API (sin Service Worker / sin Web Push).

## Global Constraints

- **Solo frontend** — sin backend, sin migración, sin dependencias nuevas.
- **Nada sale del navegador**: la notificación la crea el propio navegador con datos ya en pantalla; cero llamadas de red nuevas, cero datos a terceros.
- **El sonido NO cambia** su comportamiento actual (suena en entrantes de chats no abiertos aunque la bandeja esté enfocada).
- **Popup de escritorio solo si `!document.hasFocus()`** (la bandeja no está al frente). **Contador del título solo si `document.hidden`** (pestaña en 2º plano), y se limpia al volver.
- Preferencia por dispositivo en `localStorage` clave **`wa_notif`** (`'1'`/`'0'`), por defecto **apagado** (`activado` = false si la clave no es `'1'`). Igual patrón que `sonido` (`wa_sonido`).
- Nada rompe el flujo del socket: `mostrar()` y el contador van en try/catch; un fallo se ignora (como el sonido con el autoplay).
- Convenciones del repo: dominio en español, pinia option stores, tests con vitest.
- Comandos de test frontend: toda la suite `npm --prefix frontend test`; un archivo `npm --prefix frontend test -- <ruta>`; build `npm --prefix frontend run build`.

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `frontend/src/utils/notificacion.js` | `vistaPreviaMensaje(mensaje)` puro | Crear |
| `frontend/src/utils/notificacion.test.js` | test del helper | Crear |
| `frontend/src/stores/notificaciones.js` | store: preferencia, permiso, `mostrar()` | Crear |
| `frontend/src/stores/notificaciones.test.js` | test del store (mock Notification) | Crear |
| `frontend/src/utils/tituloPestana.js` | contador en `document.title` | Crear |
| `frontend/src/utils/tituloPestana.test.js` | test del contador | Crear |
| `frontend/src/views/Bandeja.vue` | toggle 🖥️ + iniciar el título | Modificar |
| `frontend/src/socket/cliente.js` | enganche en `mensaje:nuevo` | Modificar |

---

## Task 1: Helper puro `vistaPreviaMensaje`

**Files:**
- Create: `frontend/src/utils/notificacion.js`
- Test: `frontend/src/utils/notificacion.test.js`

**Interfaces:**
- Produces: `vistaPreviaMensaje(mensaje) → string`. `mensaje` = `{ tipo, texto }`. Devuelve el texto recortado a 120 (con `…` si excede), o una etiqueta de media si no hay texto.

- [ ] **Step 1: Escribir el test**

Create `frontend/src/utils/notificacion.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { vistaPreviaMensaje } from './notificacion';

describe('vistaPreviaMensaje', () => {
  it('devuelve el texto, recortado a 120 con elipsis', () => {
    expect(vistaPreviaMensaje({ tipo: 'text', texto: 'hola' })).toBe('hola');
    const r = vistaPreviaMensaje({ tipo: 'text', texto: 'a'.repeat(200) });
    expect(r.length).toBe(120);
    expect(r.endsWith('…')).toBe(true);
  });
  it('etiqueta media cuando no hay texto', () => {
    expect(vistaPreviaMensaje({ tipo: 'image', texto: '' })).toBe('📷 Imagen');
    expect(vistaPreviaMensaje({ tipo: 'audio' })).toBe('🎤 Audio');
    expect(vistaPreviaMensaje({ tipo: 'video' })).toBe('🎬 Video');
    expect(vistaPreviaMensaje({ tipo: 'document' })).toBe('📎 Documento');
  });
  it('tipo desconocido sin texto → genérico', () => {
    expect(vistaPreviaMensaje({ tipo: 'raro' })).toBe('Nuevo mensaje');
  });
  it('el texto gana sobre el tipo (imagen con caption)', () => {
    expect(vistaPreviaMensaje({ tipo: 'image', texto: 'mira esto' })).toBe('mira esto');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/utils/notificacion.test.js`
Expected: FAIL — `vistaPreviaMensaje` no exportado.

- [ ] **Step 3: Escribir el helper**

Create `frontend/src/utils/notificacion.js`:

```js
// Vista previa de un mensaje entrante para la notificación de escritorio: el
// texto recortado, o una etiqueta según el tipo de media si no trae texto.
const RECORTE = 120;

const ETIQUETAS_MEDIA = {
  image: '📷 Imagen',
  audio: '🎤 Audio',
  video: '🎬 Video',
  document: '📎 Documento',
  sticker: 'Sticker',
  location: '📍 Ubicación',
};

export function vistaPreviaMensaje(mensaje) {
  const texto = mensaje && mensaje.texto ? String(mensaje.texto).trim() : '';
  if (texto) return texto.length > RECORTE ? `${texto.slice(0, RECORTE - 1)}…` : texto;
  return ETIQUETAS_MEDIA[mensaje && mensaje.tipo] || 'Nuevo mensaje';
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/utils/notificacion.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/notificacion.js frontend/src/utils/notificacion.test.js
git commit -m "feat(notificaciones): helper puro de vista previa del mensaje"
```

---

## Task 2: Store `notificaciones`

**Files:**
- Create: `frontend/src/stores/notificaciones.js`
- Test: `frontend/src/stores/notificaciones.test.js`

**Interfaces:**
- Produces: `useNotificaciones()` (pinia store) con:
  - estado `activado` (bool, ← `localStorage['wa_notif'] === '1'`).
  - getters `soportado` (`'Notification' in window`), `permiso` (`Notification.permission` o `'denied'` si no soportado), `bloqueado` (`permiso === 'denied'`).
  - `async activar()`, `desactivar()`, `async alternar()`.
  - `mostrar({ conversacionId, titulo, cuerpo, onAbrir })`: crea la notificación solo si `activado` + permiso `granted` + `!document.hasFocus()`. `onAbrir` (opcional) se llama en el clic tras `window.focus()`.

- [ ] **Step 1: Escribir el test**

Create `frontend/src/stores/notificaciones.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useNotificaciones } from './notificaciones';

function stubNotification({ permission = 'default', requestResult = 'granted' } = {}) {
  const ctor = vi.fn();
  ctor.permission = permission;
  ctor.requestPermission = vi.fn().mockResolvedValue(requestResult);
  global.Notification = ctor;
  window.Notification = ctor;
  return ctor;
}

describe('store notificaciones', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); document.hasFocus = () => false; });
  afterEach(() => { delete global.Notification; delete window.Notification; });

  it('activar() con permiso granted activa y persiste', async () => {
    stubNotification({ requestResult: 'granted' });
    const n = useNotificaciones();
    await n.activar();
    expect(n.activado).toBe(true);
    expect(localStorage.getItem('wa_notif')).toBe('1');
  });
  it('activar() con permiso denegado no activa', async () => {
    stubNotification({ requestResult: 'denied' });
    const n = useNotificaciones();
    await n.activar();
    expect(n.activado).toBe(false);
  });
  it('bloqueado cuando permission=denied; activar() no pide permiso', async () => {
    const ctor = stubNotification({ permission: 'denied' });
    const n = useNotificaciones();
    expect(n.bloqueado).toBe(true);
    await n.activar();
    expect(ctor.requestPermission).not.toHaveBeenCalled();
  });
  it('mostrar() no crea notificación si no está activado', () => {
    const ctor = stubNotification({ permission: 'granted' });
    useNotificaciones().mostrar({ conversacionId: 1, titulo: 'x', cuerpo: 'y' });
    expect(ctor).not.toHaveBeenCalled();
  });
  it('mostrar() no crea notificación si la bandeja está enfocada', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => true;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 1, titulo: 'x', cuerpo: 'y' });
    expect(ctor).not.toHaveBeenCalled();
  });
  it('mostrar() crea la notificación con tag por conversación cuando corresponde', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => false;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 7, titulo: 'Luis', cuerpo: 'hola' });
    expect(ctor).toHaveBeenCalledWith('Luis', { body: 'hola', tag: 'wa-conv-7' });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/stores/notificaciones.test.js`
Expected: FAIL — no se puede importar `useNotificaciones`.

- [ ] **Step 3: Escribir el store**

Create `frontend/src/stores/notificaciones.js`:

```js
import { defineStore } from 'pinia';

const CLAVE = 'wa_notif';

// Notificación de escritorio del navegador para entrantes. Preferencia por
// dispositivo (localStorage), apagada por defecto (requiere permiso). El propio
// navegador crea el popup; nada sale de aquí.
export const useNotificaciones = defineStore('notificaciones', {
  state: () => ({ activado: localStorage.getItem(CLAVE) === '1' }),
  getters: {
    soportado: () => typeof window !== 'undefined' && 'Notification' in window,
    permiso() { return this.soportado ? Notification.permission : 'denied'; },
    bloqueado() { return this.permiso === 'denied'; },
  },
  actions: {
    async activar() {
      if (!this.soportado || this.bloqueado) return;
      // requestPermission DEBE ir en un gesto del usuario (el clic del toggle).
      const permiso = await Notification.requestPermission();
      if (permiso === 'granted') { this.activado = true; localStorage.setItem(CLAVE, '1'); }
    },
    desactivar() { this.activado = false; localStorage.setItem(CLAVE, '0'); },
    async alternar() { if (this.activado) this.desactivar(); else await this.activar(); },
    mostrar({ conversacionId, titulo, cuerpo, onAbrir }) {
      if (!this.activado || !this.soportado || Notification.permission !== 'granted') return;
      // No molestar con un popup del SO si el agente ya está mirando la bandeja.
      if (typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) return;
      try {
        const n = new Notification(titulo, { body: cuerpo, tag: `wa-conv-${conversacionId}` });
        n.onclick = () => {
          try { window.focus(); } catch { /* ignore */ }
          if (typeof onAbrir === 'function') onAbrir();
          n.close();
        };
      } catch { /* algunos navegadores lanzan en contextos raros; no romper el socket */ }
    },
  },
});
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/stores/notificaciones.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/notificaciones.js frontend/src/stores/notificaciones.test.js
git commit -m "feat(notificaciones): store con permiso, preferencia y mostrar()"
```

---

## Task 3: Contador en el título de la pestaña

**Files:**
- Create: `frontend/src/utils/tituloPestana.js`
- Test: `frontend/src/utils/tituloPestana.test.js`

**Interfaces:**
- Produces: `iniciarTituloPestana()` (captura el título base una vez y registra el listener de `visibilitychange` que limpia al volver), `nuevoEnTitulo()` (suma 1 solo si `document.hidden`), `_resetTituloPestana()` (solo para test).

- [ ] **Step 1: Escribir el test**

Create `frontend/src/utils/tituloPestana.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { iniciarTituloPestana, nuevoEnTitulo, _resetTituloPestana } from './tituloPestana';

function setHidden(v) { Object.defineProperty(document, 'hidden', { value: v, configurable: true }); }

describe('tituloPestana', () => {
  beforeEach(() => { _resetTituloPestana(); document.title = 'Bandeja'; });

  it('suma al título cuando la pestaña está en 2º plano', () => {
    setHidden(true);
    iniciarTituloPestana();
    nuevoEnTitulo();
    nuevoEnTitulo();
    expect(document.title).toBe('(2) Bandeja');
  });
  it('no suma cuando la pestaña está visible', () => {
    setHidden(false);
    iniciarTituloPestana();
    nuevoEnTitulo();
    expect(document.title).toBe('Bandeja');
  });
  it('limpia el contador al volver a la pestaña', () => {
    setHidden(true);
    iniciarTituloPestana();
    nuevoEnTitulo();
    expect(document.title).toBe('(1) Bandeja');
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe('Bandeja');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm --prefix frontend test -- src/utils/tituloPestana.test.js`
Expected: FAIL — funciones no exportadas.

- [ ] **Step 3: Escribir el módulo**

Create `frontend/src/utils/tituloPestana.js`:

```js
// Contador de mensajes nuevos en el título de la pestaña — respaldo visual que
// funciona sin permiso de notificaciones. Solo cuenta cuando la pestaña está en
// 2º plano; se limpia al volver a ella. La app tiene una sola pestaña, por eso
// el estado a nivel de módulo es suficiente.
let base = '';
let contador = 0;
let iniciado = false;

function pintar() {
  document.title = contador > 0 ? `(${contador}) ${base}` : base;
}

export function iniciarTituloPestana() {
  if (iniciado) return;
  iniciado = true;
  base = document.title;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { contador = 0; pintar(); }
  });
}

export function nuevoEnTitulo() {
  if (typeof document === 'undefined' || !document.hidden) return;
  contador += 1;
  pintar();
}

// Solo para test: reinicia el estado del módulo.
export function _resetTituloPestana() { base = ''; contador = 0; iniciado = false; }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm --prefix frontend test -- src/utils/tituloPestana.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/tituloPestana.js frontend/src/utils/tituloPestana.test.js
git commit -m "feat(notificaciones): contador de entrantes en el título de la pestaña"
```

---

## Task 4: Toggle en la cabecera + enganche en el socket

**Files:**
- Modify: `frontend/src/views/Bandeja.vue`
- Modify: `frontend/src/socket/cliente.js`

**Interfaces:**
- Consumes: `useNotificaciones` (Task 2), `vistaPreviaMensaje` (Task 1), `iniciarTituloPestana`/`nuevoEnTitulo` (Task 3).
- Produces: toggle 🖥️ en el menú de la cabecera; el handler `mensaje:nuevo` muestra la notificación y suma al título.

- [ ] **Step 1: Cablear el store y el título en `Bandeja.vue`**

In `frontend/src/views/Bandeja.vue`, add the import next to `useSonido`:

```js
import { useNotificaciones } from '../stores/notificaciones';
import { iniciarTituloPestana } from '../utils/tituloPestana';
```

Add the store instance next to `const sonido = useSonido();`:

```js
const notif = useNotificaciones();
```

Ensure `onMounted` is imported from `vue` (add it to the existing `vue` import if not present) and initialize the title counter on mount. Add (or extend an existing `onMounted`):

```js
onMounted(() => { iniciarTituloPestana(); });
```

- [ ] **Step 2: Añadir el botón del toggle en el template**

In `frontend/src/views/Bandeja.vue`, immediately after the sound toggle button (the one with `sonido.alternar()`), add:

```html
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!notif.soportado || notif.bloqueado"
            :title="notif.bloqueado ? 'Permiso de notificaciones bloqueado en el navegador' : ''"
            @click="notif.alternar()">{{ notif.activado ? '🖥️ Notificaciones' : '🖥️ Activar notificaciones' }}</button>
```

- [ ] **Step 3: Enganchar la notificación en el socket**

In `frontend/src/socket/cliente.js`, add the imports near the top (next to the existing `useSonido` / `useChat` imports):

```js
import { useNotificaciones } from '../stores/notificaciones';
import { vistaPreviaMensaje } from '../utils/notificacion';
import { nuevoEnTitulo } from '../utils/tituloPestana';
```

Replace the current sound line inside the `mensaje:nuevo` handler:

```js
    if (!abierta && mensaje.direccion === 'in') useSonido().reproducir();
```

with:

```js
    if (!abierta && mensaje.direccion === 'in') {
      useSonido().reproducir();
      const titulo = item?.contacto?.nombreDisplay || item?.contacto?.nombreWa || item?.contacto?.telefono || 'Nuevo mensaje';
      useNotificaciones().mostrar({
        conversacionId,
        titulo,
        cuerpo: vistaPreviaMensaje(mensaje),
        onAbrir: () => {
          const conv = useConversaciones().items.find((c) => c.id === conversacionId);
          if (conv) useChat().abrir(conv);
        },
      });
      nuevoEnTitulo();
    }
```

- [ ] **Step 4: Correr toda la suite frontend**

Run: `npm --prefix frontend test`
Expected: PASS (los tests existentes + los 3 archivos nuevos; sin regresiones).

- [ ] **Step 5: Build**

Run: `npm --prefix frontend run build`
Expected: build OK, sin errores.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Bandeja.vue frontend/src/socket/cliente.js
git commit -m "feat(notificaciones): toggle en la cabecera + popup y título en el socket"
```

---

## Despliegue (tras merge)

Solo frontend, sin migración ni dependencias:

```bash
ssh mantix 'cd ~/apps/wa && git pull --ff-only && npm --prefix frontend run build'
```

(No hace falta reiniciar pm2: es un build estático que sirve `wa-backend`; si el navegador cachea, un refresco fuerte basta. Reiniciar `wa-backend` es opcional para invalidar assets.)

**Verificación en vivo (el usuario):** en la bandeja, abrir el menú → “🖥️ Activar notificaciones”, conceder el permiso del navegador. Ponerse en otra pestaña/app y hacer que llegue un entrante de un chat no abierto: debe aparecer el popup con el nombre del contacto + vista previa, al hacer clic enfoca la ventana y abre el chat, y el título de la pestaña muestra el contador mientras está en 2º plano.
