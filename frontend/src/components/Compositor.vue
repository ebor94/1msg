<script setup>
import { ref, computed } from 'vue';
import { useChat } from '../stores/chat';
import { ventanaAbierta } from '../utils/formato';
import SelectorPlantilla from './SelectorPlantilla.vue';

const chat = useChat();
const texto = ref('');
const mostrarSelector = ref(false);
const abierta = computed(() => ventanaAbierta(chat.conversacion?.ventanaExpiraEn));

async function enviar() {
  const t = texto.value.trim();
  if (!t || chat.enviando) return;
  texto.value = '';
  await chat.enviar(t);
}
</script>

<template>
  <div class="bg-[#f0f2f5] border-t border-gray-200 p-2.5">
    <div v-if="!abierta" class="text-center text-[12px] text-amber-700 bg-amber-50 rounded py-2 px-2">
      Fuera de la ventana de 24h.
      <button class="ml-2 underline text-marca-oscuro font-semibold" @click="mostrarSelector = true">Usar plantilla</button>
    </div>
    <div v-else class="flex items-center gap-2">
      <input v-model="texto" @keydown.enter="enviar" :disabled="chat.enviando"
        placeholder="Escribe un mensaje…" class="flex-1 bg-white rounded-full px-4 py-2 text-[13px] outline-none" />
      <button @click="enviar" :disabled="chat.enviando || !texto.trim()"
        class="w-10 h-10 rounded-full bg-marca text-white grid place-items-center disabled:opacity-50">➤</button>
    </div>
    <div v-if="chat.errorEnvio" class="text-center text-[12px] text-red-600 mt-1">{{ chat.errorEnvio }}</div>
    <SelectorPlantilla v-if="mostrarSelector" @cerrar="mostrarSelector = false" />
  </div>
</template>
