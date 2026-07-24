<script setup>
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { iniciales } from '../utils/formato';
import ListaConversaciones from '../components/ListaConversaciones.vue';

const auth = useAuth();
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
    <div class="flex-1 min-h-0 grid" style="grid-template-columns: 340px 1fr;">
      <aside class="border-r border-gray-200 min-h-0"><ListaConversaciones /></aside>
      <main class="grid place-items-center text-gray-400 bg-gray-50">
        Selecciona un chat (el detalle llega en el Plan 3)
      </main>
    </div>
  </div>
</template>
