<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { useSonido } from '../stores/sonido';
import { iniciales } from '../utils/formato';
import { PAISES, componerTelefono } from '../utils/paises';
import { conectarSocket, desconectarSocket } from '../socket/cliente';
import ListaConversaciones from '../components/ListaConversaciones.vue';
import VistaChat from '../components/VistaChat.vue';
import PanelCliente from '../components/PanelCliente.vue';
import PanelAgentes from '../components/PanelAgentes.vue';
import PanelEstadisticas from '../components/PanelEstadisticas.vue';
import PanelCambiarClave from '../components/PanelCambiarClave.vue';
import PanelProductos from '../components/PanelProductos.vue';

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
const mostrarCambioClave = ref(false);
const mostrarProductos = ref(false);
const mostrarNuevo = ref(false);
const menuAbierto = ref(false); // menú desplegable de la cabecera (agrupa las acciones)
const nuevoTelefono = ref('');
const nuevoNombre = ref('');
const nuevoError = ref('');
const nuevoOk = ref('');
const paisCodigo = ref(PAISES[0].codigo); // Colombia +57 por defecto
// Número internacional compuesto (indicativo + número local que teclea el agente).
const nuevoTelCompuesto = computed(() => componerTelefono(paisCodigo.value, nuevoTelefono.value));

function abrirNuevo() {
  nuevoTelefono.value = '';
  nuevoNombre.value = '';
  nuevoError.value = '';
  nuevoOk.value = '';
  paisCodigo.value = PAISES[0].codigo;
  mostrarNuevo.value = true;
}

function cerrarNuevo() {
  mostrarNuevo.value = false;
}

async function crearContacto() {
  nuevoError.value = '';
  nuevoOk.value = '';
  try {
    await acc.crearContacto(nuevoTelCompuesto.value, nuevoNombre.value.trim());
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
      <div class="font-bold">WhatsApp Olivos Cúcuta</div>
      <!-- Menú unificado: agrupa todas las acciones (se despliega desde el avatar). -->
      <div class="relative">
        <button class="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-full pl-3 pr-2 py-1"
          @click="menuAbierto = !menuAbierto">
          <span class="hidden sm:inline text-sm max-w-[160px] truncate">{{ auth.agente?.nombre }}</span>
          <div class="w-7 h-7 rounded-full bg-marca grid place-items-center text-xs font-bold shrink-0">{{ iniciales(auth.agente?.nombre) }}</div>
          <span class="text-white/70 text-[10px]">▼</span>
        </button>

        <!-- Fondo para cerrar al tocar afuera -->
        <div v-if="menuAbierto" class="fixed inset-0 z-40" @click="menuAbierto = false"></div>

        <!-- Desplegable -->
        <div v-if="menuAbierto"
          class="absolute right-0 mt-2 w-60 bg-white text-gray-700 rounded-lg shadow-lg z-50 py-1 text-[13px] overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100">
            <div class="font-semibold text-gray-800 truncate">{{ auth.agente?.nombre }}</div>
            <div class="text-[11px] text-gray-400 capitalize">{{ auth.agente?.rol }}</div>
          </div>
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarAgentes = true">📊 Agentes</button>
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarEtiquetas = true">🏷️ Etiquetas</button>
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; abrirNuevo()">＋ Nuevo contacto</button>
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; router.push('/informe')">📋 Informe de contactos</button>
          <button v-if="auth.esAdministrador" class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; router.push('/seguimiento')">📈 Seguimiento de agentes</button>
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarProductos = true">🔎 Consultar productos</button>
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="sonido.alternar()">{{ sonido.activado ? '🔔 Silenciar sonido' : '🔕 Activar sonido' }}</button>
          <button class="w-full text-left px-3 py-2 hover:bg-gray-50"
            @click="menuAbierto = false; mostrarCambioClave = true">🔑 Cambiar contraseña</button>
          <div class="border-t border-gray-100 my-1"></div>
          <button class="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600"
            @click="menuAbierto = false; salir()">↩ Salir</button>
        </div>
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
        <label class="block text-[11px] text-gray-400 uppercase mb-1">País</label>
        <select v-model="paisCodigo" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2">
          <option v-for="p in PAISES" :key="p.codigo + p.nombre" :value="p.codigo">{{ p.bandera }} {{ p.nombre }} +{{ p.codigo }}</option>
        </select>
        <label class="block text-[11px] text-gray-400 uppercase mb-1">Teléfono</label>
        <input v-model="nuevoTelefono" inputmode="numeric" placeholder="Número (sin indicativo)" class="w-full border rounded px-2 py-1.5 text-[13px] mb-1" />
        <p v-if="nuevoTelefono" class="text-[11px] text-gray-400 mb-2">Se creará: +{{ nuevoTelCompuesto }}</p>
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
    <PanelCambiarClave v-if="mostrarCambioClave" @cerrar="mostrarCambioClave = false" />
    <PanelProductos v-if="mostrarProductos" @cerrar="mostrarProductos = false" />
  </div>
</template>
