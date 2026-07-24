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
