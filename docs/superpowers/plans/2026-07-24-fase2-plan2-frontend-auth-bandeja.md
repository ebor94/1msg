# Fase 2 · Plan 2 — Frontend: scaffold + login + lista de bandeja

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un frontend Vue donde un agente inicia sesión con sus credenciales de `serfuweb` y ve su bandeja (lista de conversaciones Míos/General con último mensaje, hora y no leídos), consumiendo la API del Plan 1.

**Architecture:** SPA Vue 3 (Vite + Pinia + Vue Router + Tailwind) en `frontend/`, con su propio `package.json`. Habla con el backend por `/api` (JWT en `Authorization: Bearer`). En dev, Vite hace proxy de `/api` a `http://localhost:3000`. En prod, `vite build` genera `frontend/dist` y el Express de la Fase 1 lo sirve como estático + fallback SPA. Look tipo WhatsApp Web (aprobado en mockups); paleta placeholder.

**Tech Stack:** Vue 3 `<script setup>`, Vite, Pinia, Vue Router, Tailwind CSS, Vitest (tests de stores/lógica pura). Backend: Express (ya existente).

## Global Constraints

- El frontend NUNCA ve el token de 1msg; solo habla con nuestra `/api`.
- Nombres de dominio en español (`Bandeja`, `conversaciones`, `agente`), técnicos en inglés.
- Estilo tipo WhatsApp Web + panel de cliente (mockups aprobados); responsive (3 zonas → 1 en móvil).
- El JWT se guarda en `localStorage` bajo la clave `wa_token`; se envía en `Authorization: Bearer`.
- Al recibir 401 de la API, el cliente limpia el token y redirige a `/login`.
- Tests de lógica (stores, cliente API) con Vitest; las vistas se validan en el navegador.
- Todo el frontend vive en `frontend/`; no se mezcla con las deps del backend.

---

### Task 1: Scaffold del frontend (Vite + Vue + Pinia + Router + Tailwind)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/postcss.config.js`, `frontend/tailwind.config.js`
- Create: `frontend/src/main.js`, `frontend/src/App.vue`, `frontend/src/assets/main.css`, `frontend/src/router/index.js`
- Create: `frontend/.gitignore`
- Modify: `.gitignore` raíz (ignorar `frontend/dist`)

**Interfaces:**
- Produces: app Vue montada en `#app` con Pinia y Router; ruta `/` placeholder; `npm --prefix frontend run build` genera `frontend/dist`.

- [ ] **Step 1: Crear `frontend/package.json`**

```json
{
  "name": "bandeja-wa-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "pinia": "^2.2.0",
    "vue": "^3.5.0",
    "vue-router": "^4.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Instalar**

Run: `npm --prefix frontend install`
Expected: crea `frontend/node_modules` y `frontend/package-lock.json` sin errores.

- [ ] **Step 3: Config de Vite (con proxy a la API en dev)**

`frontend/vite.config.js`:

```js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 4: Tailwind + PostCSS + CSS base**

`frontend/tailwind.config.js`:

```js
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: { marca: { DEFAULT: '#0b6b5b', oscuro: '#075e54' } },
    },
  },
  plugins: [],
};
```

`frontend/postcss.config.js`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`frontend/src/assets/main.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #app { height: 100%; margin: 0; }
```

- [ ] **Step 5: HTML, entrypoint, App, Router**

`frontend/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bandeja WhatsApp — Serfunorte</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`frontend/src/main.js`:

```js
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/main.css';

createApp(App).use(createPinia()).use(router).mount('#app');
```

`frontend/src/App.vue`:

```vue
<template>
  <router-view />
</template>
```

`frontend/src/router/index.js`:

```js
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'bandeja', component: () => import('../views/Bandeja.vue') },
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  ],
});

export default router;
```

- [ ] **Step 6: Vistas placeholder (se reemplazan en tareas 3 y 4)**

`frontend/src/views/Login.vue`:

```vue
<template><div class="p-8">Login (pendiente)</div></template>
```

`frontend/src/views/Bandeja.vue`:

```vue
<template><div class="p-8">Bandeja (pendiente)</div></template>
```

- [ ] **Step 7: gitignore**

`frontend/.gitignore`:

```
node_modules/
dist/
```

En el `.gitignore` raíz, añadir bajo una sección nueva:

```
# Frontend build
frontend/dist/
frontend/node_modules/
```

- [ ] **Step 8: Verificar build**

Run: `npm --prefix frontend run build`
Expected: genera `frontend/dist/index.html` y assets, sin errores.

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/index.html frontend/postcss.config.js frontend/tailwind.config.js frontend/src .gitignore
git commit -m "feat(frontend): scaffold Vue 3 + Vite + Pinia + Router + Tailwind"
```

---

### Task 2: Cliente API + store de autenticación (con tests)

**Files:**
- Create: `frontend/src/api/cliente.js`
- Create: `frontend/src/stores/auth.js`
- Test: `frontend/src/stores/auth.test.js`
- Create: `frontend/vitest.config.js`

**Interfaces:**
- Consumes: `fetch` global.
- Produces:
  - `apiFetch(ruta, opciones)` — antepone `/api`, añade `Authorization: Bearer <token>` si hay token en `localStorage['wa_token']`, parsea JSON; ante 401 borra el token y lanza `Error` con `.status = 401`. Devuelve el cuerpo JSON.
  - store `useAuth` con estado `{ token, agente }`, getters `estaAutenticado`, acciones `login(usuario, clave)` (llama `POST /auth/login`, guarda token+agente y en localStorage), `cargarDeStorage()`, `logout()`.

- [ ] **Step 1: Config de Vitest**

`frontend/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 2: Escribir el test que falla**

`frontend/src/stores/auth.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuth } from './auth';

describe('store auth', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('login exitoso guarda token y agente', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ token: 'tkn', agente: { id: 1, rol: 'administrador' } }),
    });
    const auth = useAuth();
    await auth.login('bortega', 'clave');
    expect(auth.token).toBe('tkn');
    expect(auth.agente.rol).toBe('administrador');
    expect(auth.estaAutenticado).toBe(true);
    expect(localStorage.getItem('wa_token')).toBe('tkn');
  });

  it('login con credenciales malas lanza y no autentica', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'credenciales inválidas' }),
    });
    const auth = useAuth();
    await expect(auth.login('x', 'y')).rejects.toThrow();
    expect(auth.estaAutenticado).toBe(false);
  });

  it('logout limpia estado y storage', () => {
    const auth = useAuth();
    auth.token = 'tkn'; auth.agente = { id: 1 };
    localStorage.setItem('wa_token', 'tkn');
    auth.logout();
    expect(auth.token).toBe(null);
    expect(localStorage.getItem('wa_token')).toBe(null);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npm --prefix frontend test`
Expected: FAIL (no existe `./auth`).

- [ ] **Step 4: Implementar el cliente API**

`frontend/src/api/cliente.js`:

```js
const CLAVE_TOKEN = 'wa_token';

export function tokenGuardado() {
  return localStorage.getItem(CLAVE_TOKEN);
}

export async function apiFetch(ruta, opciones = {}) {
  const cabeceras = { 'content-type': 'application/json', ...(opciones.headers || {}) };
  const token = tokenGuardado();
  if (token) cabeceras.authorization = `Bearer ${token}`;

  const resp = await fetch(`/api${ruta}`, { ...opciones, headers: cabeceras });
  let cuerpo = null;
  try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }

  if (resp.status === 401) {
    localStorage.removeItem(CLAVE_TOKEN);
    const e = new Error((cuerpo && cuerpo.error) || 'no autenticado');
    e.status = 401;
    throw e;
  }
  if (!resp.ok) {
    const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return cuerpo;
}

export { CLAVE_TOKEN };
```

- [ ] **Step 5: Implementar el store**

`frontend/src/stores/auth.js`:

```js
import { defineStore } from 'pinia';
import { apiFetch, CLAVE_TOKEN } from '../api/cliente';

export const useAuth = defineStore('auth', {
  state: () => ({ token: null, agente: null }),
  getters: {
    estaAutenticado: (s) => !!s.token,
    esAdministrador: (s) => s.agente?.rol === 'administrador',
  },
  actions: {
    async login(usuario, clave) {
      const r = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, clave }),
      });
      this.token = r.token;
      this.agente = r.agente;
      localStorage.setItem(CLAVE_TOKEN, r.token);
    },
    cargarDeStorage() {
      const t = localStorage.getItem(CLAVE_TOKEN);
      if (t) this.token = t;
    },
    logout() {
      this.token = null;
      this.agente = null;
      localStorage.removeItem(CLAVE_TOKEN);
    },
  },
});
```

- [ ] **Step 6: Correr y ver que pasa**

Run: `npm --prefix frontend test`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/cliente.js frontend/src/stores/auth.js frontend/src/stores/auth.test.js frontend/vitest.config.js
git commit -m "feat(frontend): cliente API con JWT y store de autenticación"
```

---

### Task 3: Vista de login + guard de router

**Files:**
- Modify: `frontend/src/views/Login.vue`
- Modify: `frontend/src/router/index.js` (guard + meta)
- Modify: `frontend/src/App.vue` (cargar token al iniciar)

**Interfaces:**
- Consumes: store `useAuth`.
- Produces: `/login` funcional (form usuario+clave, muestra error, redirige a `/` al entrar); guard global que manda a `/login` si la ruta requiere auth y no hay token, y de `/login` a `/` si ya está autenticado.

- [ ] **Step 1: Implementar `Login.vue`**

```vue
<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';

const usuario = ref('');
const clave = ref('');
const error = ref('');
const cargando = ref(false);
const auth = useAuth();
const router = useRouter();

async function entrar() {
  error.value = '';
  cargando.value = true;
  try {
    await auth.login(usuario.value.trim(), clave.value);
    router.push('/');
  } catch (e) {
    error.value = e.status === 429 ? 'Demasiados intentos, espera unos minutos.' : 'Usuario o contraseña incorrectos.';
  } finally {
    cargando.value = false;
  }
}
</script>

<template>
  <div class="min-h-full grid place-items-center bg-gray-100 p-4">
    <form class="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4" @submit.prevent="entrar">
      <div class="text-center">
        <div class="text-xl font-bold text-marca-oscuro">Serfunorte</div>
        <div class="text-sm text-gray-500">Bandeja de WhatsApp</div>
      </div>
      <input v-model="usuario" type="text" placeholder="Usuario" autocomplete="username"
        class="w-full border rounded-lg px-3 py-2" required />
      <input v-model="clave" type="password" placeholder="Contraseña" autocomplete="current-password"
        class="w-full border rounded-lg px-3 py-2" required />
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <button type="submit" :disabled="cargando"
        class="w-full bg-marca text-white rounded-lg py-2 font-semibold disabled:opacity-60">
        {{ cargando ? 'Entrando…' : 'Entrar' }}
      </button>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Guard en el router**

Reemplazar `frontend/src/router/index.js` por:

```js
import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'bandeja', component: () => import('../views/Bandeja.vue'), meta: { requiereAuth: true } },
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  ],
});

router.beforeEach((to) => {
  const auth = useAuth();
  if (to.meta.requiereAuth && !auth.estaAutenticado) return { name: 'login' };
  if (to.name === 'login' && auth.estaAutenticado) return { name: 'bandeja' };
  return true;
});

export default router;
```

- [ ] **Step 3: Cargar token al iniciar en `App.vue`**

```vue
<script setup>
import { useAuth } from './stores/auth';
useAuth().cargarDeStorage();
</script>

<template>
  <router-view />
</template>
```

- [ ] **Step 4: Verificación manual (navegador)**

Run (en dos terminales): backend `npm start` (con `.env` real) y `npm --prefix frontend run dev`.
Abrir `http://localhost:5173`:
- Sin token → redirige a `/login`.
- Login con clave mala → mensaje "Usuario o contraseña incorrectos."
- Login con `bortega` + clave real → entra a `/` (Bandeja placeholder). Recargar mantiene la sesión (token en localStorage).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Login.vue frontend/src/router/index.js frontend/src/App.vue
git commit -m "feat(frontend): pantalla de login y guard de sesión"
```

---

### Task 4: Store y lista de conversaciones (bandeja)

**Files:**
- Create: `frontend/src/stores/conversaciones.js`
- Test: `frontend/src/stores/conversaciones.test.js`
- Create: `frontend/src/components/ListaConversaciones.vue`, `frontend/src/components/ItemConversacion.vue`
- Create: `frontend/src/utils/formato.js`
- Test: `frontend/src/utils/formato.test.js`
- Modify: `frontend/src/views/Bandeja.vue`

**Interfaces:**
- Consumes: `apiFetch`, store `useAuth`.
- Produces:
  - `formato.js`: `iniciales(nombre)`, `horaCorta(fecha)` (HH:mm si es hoy, si no 'dd/mm').
  - store `useConversaciones` con estado `{ bandeja: 'mias'|'general', items: [], cargando }`, acción `cargar(bandeja)` (GET `/conversaciones?bandeja=`), setter `cambiarBandeja(b)`.
  - `ItemConversacion.vue` (props `conversacion`) y `ListaConversaciones.vue` (pestañas + lista + estado vacío/cargando).
  - `Bandeja.vue`: cabecera con marca + agente + botón salir, y la lista a la izquierda (las zonas centro/derecha llegan en el Plan 3).

- [ ] **Step 1: Escribir tests que fallan (lógica pura + store)**

`frontend/src/utils/formato.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { iniciales } from './formato';

describe('formato', () => {
  it('iniciales toma hasta 2 palabras', () => {
    expect(iniciales('Carlos Rincón')).toBe('CR');
    expect(iniciales('María')).toBe('M');
    expect(iniciales('')).toBe('?');
  });
});
```

`frontend/src/stores/conversaciones.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConversaciones } from './conversaciones';

describe('store conversaciones', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.setItem('wa_token', 't'); });

  it('cargar llena items desde la API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ total: 1, pagina: 0, conversaciones: [{ id: 5, contacto: { nombreWa: 'Ana' } }] }),
    });
    const s = useConversaciones();
    await s.cargar('mias');
    expect(s.items.length).toBe(1);
    expect(s.items[0].id).toBe(5);
    expect(global.fetch).toHaveBeenCalledWith('/api/conversaciones?bandeja=mias', expect.anything());
  });
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm --prefix frontend test`
Expected: FAIL (no existen los módulos).

- [ ] **Step 3: Implementar `formato.js`**

```js
export function iniciales(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return partes.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export function horaCorta(fecha) {
  if (!fecha) return '';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
}
```

- [ ] **Step 4: Implementar el store**

`frontend/src/stores/conversaciones.js`:

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useConversaciones = defineStore('conversaciones', {
  state: () => ({ bandeja: 'mias', items: [], cargando: false, error: '' }),
  actions: {
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      try {
        const r = await apiFetch(`/conversaciones?bandeja=${bandeja}`);
        this.items = r.conversaciones;
      } catch (e) {
        this.error = 'No se pudo cargar la bandeja.';
        this.items = [];
      } finally {
        this.cargando = false;
      }
    },
    cambiarBandeja(b) {
      if (b !== this.bandeja) this.cargar(b);
    },
  },
});
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npm --prefix frontend test`
Expected: PASS (formato + conversaciones + auth de la tarea 2).

- [ ] **Step 6: Implementar los componentes**

`frontend/src/components/ItemConversacion.vue`:

```vue
<script setup>
import { computed } from 'vue';
import { iniciales, horaCorta } from '../utils/formato';

const props = defineProps({ conversacion: { type: Object, required: true } });
const nombre = computed(() => props.conversacion.contacto?.nombreDisplay || props.conversacion.contacto?.nombreWa || props.conversacion.contacto?.telefono || 'Sin nombre');
</script>

<template>
  <div class="flex gap-3 px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
    <div class="w-11 h-11 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold shrink-0">
      {{ iniciales(nombre) }}
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex justify-between gap-2">
        <b class="text-sm text-gray-900 truncate">{{ nombre }}</b>
        <span class="text-[11px] text-gray-400 shrink-0">{{ horaCorta(conversacion.ultimoMensajeEn) }}</span>
      </div>
      <div class="text-[12.5px] text-gray-500 truncate">{{ conversacion.ultimoMensajeTexto || '' }}</div>
    </div>
    <div v-if="conversacion.noLeidos > 0" class="self-center bg-green-500 text-white rounded-full min-w-[18px] h-[18px] px-1.5 text-[11px] grid place-items-center font-bold">
      {{ conversacion.noLeidos }}
    </div>
  </div>
</template>
```

`frontend/src/components/ListaConversaciones.vue`:

```vue
<script setup>
import { onMounted } from 'vue';
import { useConversaciones } from '../stores/conversaciones';
import { useAuth } from '../stores/auth';
import ItemConversacion from './ItemConversacion.vue';

const conv = useConversaciones();
const auth = useAuth();
onMounted(() => conv.cargar('mias'));
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex gap-1 p-2.5">
      <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'mias' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('mias')">Míos</button>
      <button class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'general' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('general')">General</button>
      <button v-if="auth.esAdministrador" class="flex-1 text-sm py-2 rounded-lg" :class="conv.bandeja === 'todos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('todos')">Todos</button>
    </div>
    <div class="flex-1 overflow-auto">
      <div v-if="conv.cargando" class="p-4 text-center text-gray-400 text-sm">Cargando…</div>
      <div v-else-if="conv.error" class="p-4 text-center text-red-500 text-sm">{{ conv.error }}</div>
      <div v-else-if="!conv.items.length" class="p-4 text-center text-gray-400 text-sm">Sin conversaciones.</div>
      <ItemConversacion v-for="c in conv.items" :key="c.id" :conversacion="c" />
    </div>
  </div>
</template>
```

- [ ] **Step 7: Implementar `Bandeja.vue`**

```vue
<script setup>
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { iniciales } from '../utils/formato';
import ListaConversaciones from '../components/ListaConversaciones.vue';

const auth = useAuth();
const router = useRouter();
function salir() { auth.logout(); router.push('/login'); }
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="bg-marca-oscuro text-white flex items-center justify-between px-4 py-2.5">
      <div class="font-bold">Serfunorte · Bandeja</div>
      <div class="flex items-center gap-2 text-sm">
        <span class="bg-white/20 px-2 py-0.5 rounded-full text-[11px] capitalize">{{ auth.agente?.rol }}</span>
        <span>{{ auth.agente?.nombre }}</span>
        <div class="w-7 h-7 rounded-full bg-marca grid place-items-center text-xs font-bold">{{ iniciales(auth.agente?.nombre) }}</div>
        <button class="ml-2 text-white/80 hover:text-white text-xs underline" @click="salir">Salir</button>
      </div>
    </header>
    <div class="flex-1 min-h-0 grid" style="grid-template-columns: 340px 1fr;">
      <aside class="border-r border-gray-200 min-h-0"><ListaConversaciones /></aside>
      <main class="grid place-items-center text-gray-400 bg-gray-50">
        Selecciona un chat (el detalle llega en el Plan 3)
      </main>
    </div>
  </div>
</template>
```

- [ ] **Step 8: Verificación manual (navegador)**

Con backend + `npm --prefix frontend run dev`, entrar con `bortega`:
- Se ve la cabecera con nombre/rol, y la lista **Míos** con conversaciones reales (las que la regla temporal le asignó), con iniciales, último mensaje, hora y badge de no leídos.
- Cambiar a **General** carga esa bandeja; como admin aparece la pestaña **Todos**.
- "Salir" vuelve a `/login`.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/stores/conversaciones.js frontend/src/stores/conversaciones.test.js frontend/src/components frontend/src/utils frontend/src/views/Bandeja.vue
git commit -m "feat(frontend): store y lista de conversaciones (bandeja)"
```

---

### Task 5: Servir el SPA desde Express + desplegar

**Files:**
- Modify: `src/app.js` (servir `frontend/dist` estático + fallback SPA, sin pisar `/api`, `/webhook`, `/health`)
- Modify: `README.md` (build del frontend en el despliegue)

**Interfaces:**
- Consumes: `frontend/dist` (generado por `vite build`).
- Produces: el backend sirve el SPA en `/` y cualquier ruta no-API devuelve `index.html`.

- [ ] **Step 1: Servir estáticos + fallback en `src/app.js`**

Añadir, DESPUÉS de montar las rutas (`app.use('/', rutas)`) y ANTES del 404, sirviendo el build solo si existe:

```js
const path = require('path');
const fs = require('fs');

const distFront = path.resolve(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distFront)) {
  app.use(express.static(distFront));
  // Fallback SPA: cualquier GET que no sea /api, /webhook, /health ni un archivo.
  app.get(/^\/(?!api|webhook|health).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(distFront, 'index.html'));
  });
}
```

(Colocarlo antes del handler 404 existente para que el 404 solo aplique a rutas de API inexistentes.)

- [ ] **Step 2: Verificar localmente**

Run: `npm --prefix frontend run build` y luego `npm start` (backend).
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` → `200` (sirve index.html).
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/conversaciones` → `401` (la API sigue respondiendo, no la pisa el fallback).

- [ ] **Step 3: Documentar el build en README**

En `README.md`, sección de despliegue, añadir el paso: `npm --prefix frontend ci && npm --prefix frontend run build` antes de reiniciar `wa-backend`.

- [ ] **Step 4: Commit**

```bash
git add src/app.js README.md
git commit -m "feat(frontend): Express sirve el SPA build con fallback de rutas"
```

- [ ] **Step 5: Desplegar y verificar en producción**

```bash
git push origin main
ssh mantix 'cd ~/apps/wa && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes" git pull -q && npm ci && npm --prefix frontend ci && npm --prefix frontend run build && pm2 restart wa-backend'
```

Abrir `https://wa.losolivoscucuta.com/` → carga la bandeja; login con credenciales reales de un agente; se ve su lista. Confirmar que `/health` y el webhook siguen respondiendo.

---

## Notas de cobertura del spec (Plan 2)

Cubre del spec: §4 (UX login + lista, tipo WhatsApp, responsive base), §5 (consumo de `/auth/login`, `/auth/me` implícito, `/conversaciones`), §8 (frontend Vue 3 + Vite + Pinia + Tailwind, servido tras el mismo dominio). **Fuera de este plan** (Plan 3+): ver chat + historial + media + panel de cliente, tiempo real (Socket.io), enviar, tomar/asignar, notificaciones, marcar-no-leído, plantillas.
