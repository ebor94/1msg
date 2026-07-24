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
