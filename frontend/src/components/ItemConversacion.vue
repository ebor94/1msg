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
