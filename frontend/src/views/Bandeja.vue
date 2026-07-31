<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { useSonido } from '../stores/sonido';
import { iniciales } from '../utils/formato';
import { conectarSocket, desconectarSocket } from '../socket/cliente';
import ListaConversaciones from '../components/ListaConversaciones.vue';
import VistaChat from '../components/VistaChat.vue';
import PanelCliente from '../components/PanelCliente.vue';
import PanelAgentes from '../components/PanelAgentes.vue';
import PanelEstadisticas from '../components/PanelEstadisticas.vue';

const auth = useAuth();
const chat = useChat();
const acc = useAcciones();
const sonido = useSonido();
const router = useRouter();

onMounted(conectarSocket);
onUnmounted(desconectarSocket);

function salir() {
  desconectarSocket();
  auth.logout();
  router.push('/login');
}

const mostrarAgentes = ref(false);
const mostrarEtiquetas = ref(false);
const mostrarNuevo = ref(false);
const nuevoTelefono = ref('');
const nuevoNombre = ref('');
const nuevoError = ref('');
const nuevoOk = ref('');

function abrirNuevo() {
  nuevoTelefono.value = '';
  nuevoNombre.value = '';
  nuevoError.value = '';
  nuevoOk.value = '';
  mostrarNuevo.value = true;
}

function cerrarNuevo() {
  mostrarNuevo.value = false;
}

async function crearContacto() {
  nuevoError.value = '';
  nuevoOk.value = '';
  try {
    await acc.crearContacto(nuevoTelefono.value.trim(), nuevoNombre.value.trim());
    // El contacto quedó en Míos y su chat se abrió: cerramos el modal.
    mostrarNuevo.value = false;
  } catch (e) {
    nuevoError.value = e.message || 'No se pudo crear el contacto.';
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="bg-marca-oscuro text-white flex items-center justify-between px-4 py-2.5">
      <div class="font-bold">Serfunorte · Bandeja</div>
      <div class="flex items-center gap-2 text-sm">
        <button v-if="auth.esAdministrador" class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[11px]" @click="mostrarAgentes = true">📊 Agentes</button>
        <button v-if="auth.esAdministrador" class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[11px]" @click="mostrarEtiquetas = true">🏷️ Etiquetas</button>
        <button class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[11px]" @click="abrirNuevo">＋ Contacto</button>
        <button class="bg-white/20 hover:bg-white/30 px-2 py-1 rounded-full text-[13px]"
          :title="sonido.activado ? 'Silenciar notificaciones' : 'Activar notificaciones'"
          @click="sonido.alternar()">{{ sonido.activado ? '🔔' : '🔕' }}</button>
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
      <main class="min-h-0 h-full" :class="chat.conversacion ? 'flex flex-col' : 'hidden md:flex md:flex-col'">
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

    <div v-if="mostrarNuevo" class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="cerrarNuevo">
      <div class="bg-white rounded-lg p-4 w-80 shadow-lg">
        <h3 class="text-sm font-semibold text-gray-800 mb-3">Nuevo contacto</h3>
        <label class="block text-[11px] text-gray-400 uppercase mb-1">Teléfono</label>
        <input v-model="nuevoTelefono" placeholder="573001234567" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2" />
        <label class="block text-[11px] text-gray-400 uppercase mb-1">Nombre</label>
        <input v-model="nuevoNombre" placeholder="Nombre (opcional)" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2" />
        <div v-if="nuevoError" class="text-[12px] text-red-500 mb-2">{{ nuevoError }}</div>
        <div v-if="nuevoOk" class="text-[12px] text-green-600 mb-2">{{ nuevoOk }}</div>
        <div class="flex justify-end gap-2 mt-2">
          <button class="text-[13px] text-gray-500 px-3 py-1.5" @click="cerrarNuevo">Cerrar</button>
          <button class="text-[13px] bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="crearContacto">Crear</button>
        </div>
      </div>
    </div>

    <PanelAgentes v-if="mostrarAgentes" @cerrar="mostrarAgentes = false" />
    <PanelEstadisticas v-if="mostrarEtiquetas" @cerrar="mostrarEtiquetas = false" />
  </div>
</template>
