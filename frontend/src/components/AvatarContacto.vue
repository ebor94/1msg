<script setup>
// Avatar genérico de contacto (ícono de persona, estilo WhatsApp sin foto).
// Reemplaza el avatar de iniciales. `clase` controla tamaño/margen (ej. 'w-11 h-11').
defineProps({ clase: { type: String, default: 'w-11 h-11' } });
</script>

<template>
  <div :class="clase" class="rounded-full bg-gray-400 overflow-hidden grid place-items-center shrink-0">
    <svg viewBox="0 0 24 24" class="w-full h-full text-gray-100" fill="currentColor" aria-hidden="true">
      <path d="M12 12.6c2.32 0 4.2-1.88 4.2-4.2S14.32 4.2 12 4.2 7.8 6.08 7.8 8.4 9.68 12.6 12 12.6Zm0 1.6c-3.2 0-8 1.6-8 4.8V21h16v-2c0-3.2-4.8-4.8-8-4.8Z" />
    </svg>
  </div>
</template>
