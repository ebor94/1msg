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
        <b class="text-sm text-gray-900 truncate min-w-0">{{ nombre }}</b>
        <span class="text-[11px] text-gray-400 shrink-0">{{ horaCorta(conversacion.ultimoMensajeEn) }}</span>
      </div>
      <div class="text-[12.5px] text-gray-500 line-clamp-2 [overflow-wrap:anywhere]">{{ conversacion.ultimoMensajeTexto || '' }}</div>
    </div>
    <div v-if="conversacion.noLeidos > 0" class="self-center bg-green-500 text-white rounded-full min-w-[18px] h-[18px] px-1.5 text-[11px] grid place-items-center font-bold">
      {{ conversacion.noLeidos }}
    </div>
  </div>
</template>
