# Fase 2 · Plan 3 — Ver el chat (historial + panel de cliente)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el agente abra una conversación de su bandeja y lea el historial (burbujas entrantes/salientes con hora y estado de entrega), con el panel de cliente a la derecha, cerrando el layout de 3 zonas. Al abrir, la conversación se marca como leída.

**Architecture:** Solo frontend (Vue). El backend del Plan 1 ya expone `GET /api/conversaciones/:id/mensajes` y `POST /api/conversaciones/:id/leer`. Se añade un store `chat` (mensajes de la conversación abierta), la vista del chat, el panel de cliente, y se cablea la selección desde la lista. Los mensajes de media se muestran como etiqueta (`[imagen]`…); el visor real es de un plan posterior.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vitest. Sin cambios de backend.

## Global Constraints

- Las vistas usan los stores/`apiFetch`; nunca `fetch`/`localStorage` directo.
- Orden de mensajes ascendente por `ts_proveedor` (lo entrega así el backend); el chat hace scroll al fondo al abrir.
- Al abrir una conversación se marca leída (`POST /leer`) y el badge de no leídos de esa conversación en la lista pasa a 0.
- Estilo tipo WhatsApp: burbujas `in` (blancas, izquierda) / `out` (verdes, derecha) con hora y, en salientes, ícono de estado.
- Nombres de dominio en español, técnicos en inglés.
- Media (image/audio/video/document/sticker) se muestra como etiqueta `[tipo]` por ahora — sin visor.
- Tests de lógica (stores, formatters) con Vitest; las vistas se validan en navegador.

---

### Task 1: Formateadores de mensaje (estado + hora larga)

**Files:**
- Modify: `frontend/src/utils/formato.js`
- Modify: `frontend/src/utils/formato.test.js`

**Interfaces:**
- Produces:
  - `iconoEstado(estado)`: `'pendiente'→'🕓'`, `'enviado'→'✓'`, `'entregado'→'✓✓'`, `'leido'→'✓✓'`, `'fallido'→'⚠'`, otro→`''`.
  - `esLeido(estado)`: `true` solo para `'leido'` (para pintar el ✓✓ azul).
  - `etiquetaTipo(tipo)`: `image→'[imagen]'`, `audio→'[audio]'`, `video→'[video]'`, `document→'[documento]'`, `sticker→'[sticker]'`, otro→`null`.

- [ ] **Step 1: Añadir los tests que fallan**

Agregar dentro de `frontend/src/utils/formato.test.js` (mismo `describe`):

```js
import { iconoEstado, esLeido, etiquetaTipo } from './formato';

it('iconoEstado mapea estados de entrega', () => {
  expect(iconoEstado('enviado')).toBe('✓');
  expect(iconoEstado('entregado')).toBe('✓✓');
  expect(iconoEstado('leido')).toBe('✓✓');
  expect(iconoEstado('fallido')).toBe('⚠');
  expect(iconoEstado('otro')).toBe('');
});

it('esLeido solo true para leido', () => {
  expect(esLeido('leido')).toBe(true);
  expect(esLeido('entregado')).toBe(false);
});

it('etiquetaTipo para media, null para texto', () => {
  expect(etiquetaTipo('image')).toBe('[imagen]');
  expect(etiquetaTipo('text')).toBe(null);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npm --prefix frontend test`
Expected: FAIL (funciones no exportadas).

- [ ] **Step 3: Implementar en `frontend/src/utils/formato.js`**

Añadir al final:

```js
const ICONO_ESTADO = {
  pendiente: '🕓', enviado: '✓', entregado: '✓✓', leido: '✓✓', fallido: '⚠',
};
export function iconoEstado(estado) {
  return ICONO_ESTADO[estado] || '';
}

export function esLeido(estado) {
  return estado === 'leido';
}

const ETIQUETA_TIPO = {
  image: '[imagen]', audio: '[audio]', video: '[video]', document: '[documento]', sticker: '[sticker]',
};
export function etiquetaTipo(tipo) {
  return ETIQUETA_TIPO[tipo] || null;
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npm --prefix frontend test`
Expected: PASS (todos, incluidos los previos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/formato.js frontend/src/utils/formato.test.js
git commit -m "feat(frontend): formateadores de estado de entrega y etiqueta de media"
```

---

### Task 2: Store del chat abierto (mensajes + marcar leído)

**Files:**
- Create: `frontend/src/stores/chat.js`
- Test: `frontend/src/stores/chat.test.js`

**Interfaces:**
- Consumes: `apiFetch`, `useConversaciones` (para poner en 0 el badge de la conversación abierta).
- Produces: store `useChat` con estado `{ conversacion: null, mensajes: [], cargando: false, error: '' }` y acción `abrir(conversacion)` que: guarda `this.conversacion = conversacion`, hace `GET /conversaciones/:id/mensajes` → `this.mensajes = r.mensajes`, luego `POST /conversaciones/:id/leer` y pone `noLeidos = 0` en esa conversación dentro de `useConversaciones().items` y en `this.conversacion`. Y `cerrar()` que limpia el estado.

- [ ] **Step 1: Escribir el test que falla**

`frontend/src/stores/chat.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

describe('store chat', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.setItem('wa_token', 't'); });

  it('abrir carga mensajes, marca leído y pone el badge en 0', async () => {
    const conv = useConversaciones();
    conv.items = [{ id: 5, noLeidos: 3, contacto: { nombreWa: 'Ana' } }];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mensajes: [{ id: 1, direccion: 'in', texto: 'hola' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const chat = useChat();
    await chat.abrir(conv.items[0]);

    expect(chat.mensajes.length).toBe(1);
    expect(chat.conversacion.id).toBe(5);
    expect(conv.items[0].noLeidos).toBe(0);
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/conversaciones/5/mensajes', expect.anything());
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/conversaciones/5/leer', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm --prefix frontend test`
Expected: FAIL (no existe `./chat`).

- [ ] **Step 3: Implementar `frontend/src/stores/chat.js`**

```js
import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useConversaciones } from './conversaciones';

export const useChat = defineStore('chat', {
  state: () => ({ conversacion: null, mensajes: [], cargando: false, error: '' }),
  actions: {
    async abrir(conversacion) {
      this.conversacion = conversacion;
      this.mensajes = [];
      this.cargando = true;
      this.error = '';
      try {
        const r = await apiFetch(`/conversaciones/${conversacion.id}/mensajes`);
        this.mensajes = r.mensajes;
        await apiFetch(`/conversaciones/${conversacion.id}/leer`, { method: 'POST' });
        this.marcarLeidaEnLista(conversacion.id);
      } catch (e) {
        this.error = 'No se pudo abrir la conversación.';
      } finally {
        this.cargando = false;
      }
    },
    marcarLeidaEnLista(id) {
      if (this.conversacion) this.conversacion.noLeidos = 0;
      const item = useConversaciones().items.find((c) => c.id === id);
      if (item) item.noLeidos = 0;
    },
    cerrar() {
      this.conversacion = null;
      this.mensajes = [];
    },
  },
});
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm --prefix frontend test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/chat.js frontend/src/stores/chat.test.js
git commit -m "feat(frontend): store del chat abierto (mensajes + marcar leído)"
```

---

### Task 3: Componentes del chat (burbujas)

**Files:**
- Create: `frontend/src/components/BurbujaMensaje.vue`
- Create: `frontend/src/components/VistaChat.vue`

**Interfaces:**
- Consumes: store `useChat`, `formato` (`horaCorta`, `iconoEstado`, `esLeido`, `etiquetaTipo`), `iniciales`.
- Produces:
  - `BurbujaMensaje.vue` (prop `mensaje`): burbuja alineada por `direccion`, muestra el texto (o la etiqueta de media si aplica), hora y —solo en salientes— el ícono de estado (azul si leído).
  - `VistaChat.vue`: si no hay conversación abierta muestra un vacío ("Selecciona un chat"); si hay, muestra cabecera con nombre del contacto + las burbujas (scroll al fondo al abrir/cambiar).

- [ ] **Step 1: Implementar `BurbujaMensaje.vue`**

```vue
<script setup>
import { computed } from 'vue';
import { horaCorta, iconoEstado, esLeido, etiquetaTipo } from '../utils/formato';

const props = defineProps({ mensaje: { type: Object, required: true } });
const saliente = computed(() => props.mensaje.direccion === 'out');
const contenido = computed(() => props.mensaje.texto || etiquetaTipo(props.mensaje.tipo) || '');
</script>

<template>
  <div class="flex" :class="saliente ? 'justify-end' : 'justify-start'">
    <div class="max-w-[75%] px-2.5 py-1.5 rounded-lg text-[13.5px] leading-snug shadow-sm"
      :class="saliente ? 'bg-[#d9fdd3] rounded-tr-sm' : 'bg-white rounded-tl-sm'">
      <span class="whitespace-pre-wrap break-words">{{ contenido }}</span>
      <span class="text-[10px] text-gray-500 float-right ml-2 mt-1.5">
        {{ horaCorta(mensaje.tsProveedor) }}
        <span v-if="saliente" :class="esLeido(mensaje.estado) ? 'text-sky-500' : 'text-gray-500'">{{ iconoEstado(mensaje.estado) }}</span>
      </span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Implementar `VistaChat.vue`**

```vue
<script setup>
import { ref, watch, nextTick } from 'vue';
import { useChat } from '../stores/chat';
import { iniciales } from '../utils/formato';
import BurbujaMensaje from './BurbujaMensaje.vue';

const chat = useChat();
const contenedor = ref(null);
const nombre = (c) => c?.contacto?.nombreDisplay || c?.contacto?.nombreWa || c?.contacto?.telefono || 'Sin nombre';

async function alFondo() {
  await nextTick();
  if (contenedor.value) contenedor.value.scrollTop = contenedor.value.scrollHeight;
}
watch(() => chat.mensajes, alFondo, { deep: true });
</script>

<template>
  <div v-if="!chat.conversacion" class="h-full grid place-items-center text-gray-400 bg-gray-50">
    Selecciona un chat para ver la conversación
  </div>
  <div v-else class="h-full flex flex-col bg-[#eae6df]">
    <div class="bg-[#f0f2f5] border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold">{{ iniciales(nombre(chat.conversacion)) }}</div>
      <b class="text-sm text-gray-900">{{ nombre(chat.conversacion) }}</b>
    </div>
    <div ref="contenedor" class="flex-1 overflow-auto p-4 flex flex-col gap-1.5">
      <div v-if="chat.cargando" class="text-center text-gray-500 text-sm">Cargando…</div>
      <div v-else-if="chat.error" class="text-center text-red-500 text-sm">{{ chat.error }}</div>
      <BurbujaMensaje v-for="m in chat.mensajes" :key="m.id" :mensaje="m" />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verificar build**

Run: `npm --prefix frontend run build`
Expected: compila sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BurbujaMensaje.vue frontend/src/components/VistaChat.vue
git commit -m "feat(frontend): vista del chat con burbujas de mensaje"
```

---

### Task 4: Panel de cliente

**Files:**
- Create: `frontend/src/components/PanelCliente.vue`

**Interfaces:**
- Consumes: store `useChat`, `iniciales`.
- Produces: `PanelCliente.vue`: si hay conversación abierta muestra avatar, nombre, teléfono, estado de la conversación y origen; si no, un vacío discreto. (Etiquetas y notas llegan en un plan posterior.)

- [ ] **Step 1: Implementar `PanelCliente.vue`**

```vue
<script setup>
import { computed } from 'vue';
import { useChat } from '../stores/chat';
import { iniciales } from '../utils/formato';

const chat = useChat();
const c = computed(() => chat.conversacion);
const nombre = computed(() => c.value?.contacto?.nombreDisplay || c.value?.contacto?.nombreWa || c.value?.contacto?.telefono || 'Sin nombre');
</script>

<template>
  <div v-if="!c" class="h-full grid place-items-center text-gray-300 text-sm p-4 text-center">
    Sin conversación seleccionada
  </div>
  <div v-else class="h-full overflow-auto p-4">
    <div class="w-16 h-16 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold text-xl mx-auto mb-2">{{ iniciales(nombre) }}</div>
    <h4 class="text-center text-base text-gray-900 m-0">{{ nombre }}</h4>
    <div class="text-center text-gray-500 text-[12.5px] mb-4">{{ c.contacto?.telefono }}</div>
    <div class="text-[12.5px] text-gray-700 py-2 border-t border-gray-100 flex justify-between"><span class="text-gray-400">Estado</span><span class="capitalize">{{ c.estado }}</span></div>
    <div class="text-[12.5px] text-gray-700 py-2 border-t border-gray-100 flex justify-between"><span class="text-gray-400">Origen</span><span class="capitalize">{{ c.origen }}</span></div>
  </div>
</template>
```

- [ ] **Step 2: Verificar build**

Run: `npm --prefix frontend run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PanelCliente.vue
git commit -m "feat(frontend): panel de cliente (datos del contacto)"
```

---

### Task 5: Cablear selección + layout de 3 zonas (responsive)

**Files:**
- Modify: `frontend/src/components/ItemConversacion.vue` (emite/abre al hacer clic; resalta el seleccionado)
- Modify: `frontend/src/components/ListaConversaciones.vue` (abre el chat al hacer clic en un ítem)
- Modify: `frontend/src/views/Bandeja.vue` (3 columnas: lista | chat | panel; responsive)

**Interfaces:**
- Consumes: store `useChat` (`abrir`, `conversacion`, `cerrar`), `VistaChat`, `PanelCliente`.
- Produces: al hacer clic en una conversación se abre el chat en el centro y el panel a la derecha; en pantallas angostas el chat cubre la lista y un botón "‹" vuelve a la lista.

- [ ] **Step 1: `ItemConversacion.vue` — clic abre y resalta**

Reemplazar el `<script setup>` para usar el store del chat y marcar el seleccionado; añadir `@click` y la clase de seleccionado en la raíz:

```vue
<script setup>
import { computed } from 'vue';
import { iniciales, horaCorta } from '../utils/formato';
import { useChat } from '../stores/chat';

const props = defineProps({ conversacion: { type: Object, required: true } });
const chat = useChat();
const nombre = computed(() => props.conversacion.contacto?.nombreDisplay || props.conversacion.contacto?.nombreWa || props.conversacion.contacto?.telefono || 'Sin nombre');
const seleccionado = computed(() => chat.conversacion?.id === props.conversacion.id);
</script>

<template>
  <div class="flex gap-3 px-3 py-2.5 border-b border-gray-100 cursor-pointer"
    :class="seleccionado ? 'bg-[#eef7f4]' : 'hover:bg-gray-50'"
    @click="chat.abrir(conversacion)">
    <div class="w-11 h-11 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold shrink-0">{{ iniciales(nombre) }}</div>
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

(`ListaConversaciones.vue` no necesita cambios si el clic ya lo maneja el ítem; si tu versión pasa el clic por un emit, ajústalo para llamar `chat.abrir`. Deja el archivo consistente con lo anterior.)

- [ ] **Step 2: `Bandeja.vue` — 3 columnas + responsive**

Reemplazar el bloque `<div class="flex-1 ...grid...">` por un layout de 3 zonas que en móvil colapsa:

```vue
<script setup>
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { iniciales } from '../utils/formato';
import ListaConversaciones from '../components/ListaConversaciones.vue';
import VistaChat from '../components/VistaChat.vue';
import PanelCliente from '../components/PanelCliente.vue';

const auth = useAuth();
const chat = useChat();
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
    <div class="flex-1 min-h-0 md:grid" style="grid-template-columns: 340px 1fr 300px;">
      <!-- Lista: se oculta en móvil cuando hay chat abierto -->
      <aside class="border-r border-gray-200 min-h-0 h-full" :class="chat.conversacion ? 'hidden md:block' : 'block'">
        <ListaConversaciones />
      </aside>
      <!-- Chat: en móvil ocupa todo cuando hay uno abierto -->
      <main class="min-h-0 h-full" :class="chat.conversacion ? 'block' : 'hidden md:block'">
        <div class="md:hidden bg-[#f0f2f5] border-b border-gray-200 px-3 py-2" v-if="chat.conversacion">
          <button class="text-marca-oscuro text-sm" @click="chat.cerrar()">‹ Volver</button>
        </div>
        <VistaChat class="h-[calc(100%-0px)]" />
      </main>
      <!-- Panel: solo en escritorio -->
      <aside class="border-l border-gray-200 min-h-0 h-full hidden md:block">
        <PanelCliente />
      </aside>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Verificar tests + build**

Run: `npm --prefix frontend test` (todos verdes) y `npm --prefix frontend run build` (compila).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ItemConversacion.vue frontend/src/components/ListaConversaciones.vue frontend/src/views/Bandeja.vue
git commit -m "feat(frontend): abrir chat desde la lista y layout de 3 zonas responsive"
```

- [ ] **Step 5: Verificación manual + despliegue (controlador)**

Local: `npm --prefix frontend run dev` + backend; entrar, clic en una conversación → se ve el historial con burbujas y estados, y el panel de cliente; el badge de no leídos baja a 0. En ventana angosta, el chat cubre la lista y "‹ Volver" regresa.

Despliegue (lo hace el controlador tras la revisión final y el merge):

```bash
git push origin main
ssh mantix 'cd ~/apps/wa && GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes" git pull -q && npm --prefix frontend ci --include=dev && npm --prefix frontend run build && pm2 restart wa-backend'
```

Abrir `https://wa.losolivoscucuta.com/`, entrar y abrir una conversación real.

---

## Notas de cobertura del spec (Plan 3)

Cubre del spec: §4 (zona de conversación con burbujas in/out, estados; panel de cliente; responsive 3→1), consumo de `/conversaciones/:id/mensajes` y `/leer` (§5). **Fuera de este plan** (planes siguientes): visor de media real, tiempo real (Socket.io), enviar, tomar/asignar, notificaciones, marcar-no-leído, plantillas, etiquetas/notas editables, scroll/paginación hacia atrás.
