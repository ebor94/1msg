<script setup>
import { ref, watch, nextTick } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { iniciales } from '../utils/formato';
import BurbujaMensaje from './BurbujaMensaje.vue';
import Compositor from './Compositor.vue';

const chat = useChat();
const acc = useAcciones();
const contenedor = ref(null);
const nombre = (c) => c?.contacto?.nombreDisplay || c?.contacto?.nombreWa || c?.contacto?.telefono || 'Sin nombre';

async function marcarNoLeido() {
  try {
    await acc.marcarNoLeido(chat.conversacion.id);
    chat.cerrar(); // vuelve a la lista; el chat queda como no leído
  } catch {
    /* si falla (permiso/red), el chat queda abierto */
  }
}

async function alFondo() {
  await nextTick();
  if (contenedor.value) contenedor.value.scrollTop = contenedor.value.scrollHeight;
}
let ultimoId = null;
watch(() => chat.mensajes, (msgs) => {
  const nuevoUltimo = msgs.length ? msgs[msgs.length - 1].id : null;
  if (nuevoUltimo !== ultimoId) { ultimoId = nuevoUltimo; alFondo(); }
}, { deep: true });

async function onScroll() {
  const el = contenedor.value;
  if (!el || el.scrollTop > 60 || chat.cargandoMas || !chat.hayMas) return;
  const prevH = el.scrollHeight;
  await chat.cargarMas();
  await nextTick();
  if (contenedor.value) contenedor.value.scrollTop = contenedor.value.scrollHeight - prevH;
}

// Arrastrar-soltar: entrega el archivo al Compositor.
const compositorRef = ref(null);
const arrastrando = ref(false);
function onDrop(e) {
  arrastrando.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f && compositorRef.value) compositorRef.value.tomarArchivo(f);
}
</script>

<template>
  <div v-if="!chat.conversacion" class="h-full grid place-items-center text-gray-400 bg-gray-50">
    Selecciona un chat para ver la conversación
  </div>
  <div v-else class="h-full flex flex-col bg-[#eae6df] relative"
    @dragover.prevent="arrastrando = true" @dragleave.prevent="arrastrando = false" @drop.prevent="onDrop">
    <div class="bg-[#f0f2f5] border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold">{{ iniciales(nombre(chat.conversacion)) }}</div>
      <b class="text-sm text-gray-900">{{ nombre(chat.conversacion) }}</b>
      <button @click="marcarNoLeido" title="Marcar como no leído"
        class="ml-auto text-gray-400 hover:text-marca-oscuro text-lg">✉</button>
    </div>
    <div ref="contenedor" class="flex-1 overflow-auto p-4 flex flex-col gap-1.5" @scroll="onScroll">
      <div v-if="chat.cargandoMas" class="text-center text-[11px] text-gray-400 py-1">Cargando más…</div>
      <div v-if="chat.recuperando" class="text-center text-[11px] text-gray-400 py-1">Recuperando historial…</div>
      <div v-if="chat.cargando" class="text-center text-gray-500 text-sm">Cargando…</div>
      <div v-else-if="chat.error" class="text-center text-red-500 text-sm">{{ chat.error }}</div>
      <BurbujaMensaje v-for="m in chat.mensajes" :key="m.id" :mensaje="m" />
    </div>
    <Compositor ref="compositorRef" />
    <div v-if="arrastrando" class="absolute inset-0 bg-marca/10 border-2 border-dashed border-marca grid place-items-center z-10 pointer-events-none">
      <span class="text-marca-oscuro font-semibold">Suelta para adjuntar</span>
    </div>
  </div>
</template>
