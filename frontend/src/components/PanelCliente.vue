<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { iniciales } from '../utils/formato';

const chat = useChat();
const acc = useAcciones();
const c = computed(() => chat.conversacion);
const nombre = computed(() => c.value?.contacto?.nombreDisplay || c.value?.contacto?.nombreWa || c.value?.contacto?.telefono || 'Sin nombre');
const nuevaNota = ref('');

onMounted(() => acc.cargarAgentes());
watch(() => c.value?.id, (id) => { if (id) acc.cargarNotas(id); }, { immediate: true });

async function tomar() { await acc.tomar(c.value.id); }
async function asignarA(e) { await acc.asignar(c.value.id, e.target.value ? Number(e.target.value) : null); }
async function guardarNota() { const t = nuevaNota.value.trim(); if (!t) return; nuevaNota.value = ''; await acc.agregarNota(c.value.id, t); }
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

    <button v-if="!c.agenteId" @click="tomar" class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold">Tomar chat</button>
    <div class="mt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Asignar a</div>
      <select @change="asignarA" class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
        <option value="">— Bandeja general —</option>
        <option v-for="a in acc.agentes" :key="a.id" :value="a.id" :selected="a.id === c.agenteId">{{ a.nombre }}</option>
      </select>
    </div>
    <div class="mt-4">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Notas internas</div>
      <div v-for="n in acc.notas" :key="n.id" class="bg-amber-50 border border-amber-100 rounded p-2 text-[12px] text-gray-700 mb-1">
        {{ n.nota }} <span class="text-gray-400">— {{ n.agente }}</span>
      </div>
      <div class="flex gap-1 mt-1">
        <input v-model="nuevaNota" @keydown.enter="guardarNota" placeholder="Agregar nota…" class="flex-1 border rounded px-2 py-1 text-[12px]" />
        <button @click="guardarNota" class="bg-gray-200 rounded px-2 text-[12px]">+</button>
      </div>
    </div>
  </div>
</template>
