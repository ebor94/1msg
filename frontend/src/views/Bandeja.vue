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
      <main class="min-h-0 h-full flex flex-col" :class="chat.conversacion ? 'block' : 'hidden md:block'">
        <div class="md:hidden bg-[#f0f2f5] border-b border-gray-200 px-3 py-2" v-if="chat.conversacion">
          <button class="text-marca-oscuro text-sm" @click="chat.cerrar()">‹ Volver</button>
        </div>
        <VistaChat class="flex-1 min-h-0" />
      </main>
      <!-- Panel: solo en escritorio -->
      <aside class="border-l border-gray-200 min-h-0 h-full hidden md:block">
        <PanelCliente />
      </aside>
    </div>
  </div>
</template>
