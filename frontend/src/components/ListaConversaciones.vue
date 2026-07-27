<script setup>
import { onMounted, ref, watch } from 'vue';
import { useConversaciones } from '../stores/conversaciones';
import { useAuth } from '../stores/auth';
import { useBusqueda } from '../stores/busqueda';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import ItemConversacion from './ItemConversacion.vue';

const conv = useConversaciones();
const auth = useAuth();
const busqueda = useBusqueda();
const chat = useChat();
const acc = useAcciones();

onMounted(() => { conv.cargar('mias'); acc.cargarAgentes(); });

const texto = ref('');
let debounce = null;
watch(texto, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => busqueda.buscar(v), 300);
});

const soloDigitos = (s) => s.replace(/\D/g, '');
const porConfirmar = ref(null); // resultado de otro agente pendiente de confirmar
const errorAccion = ref('');

function limpiar() {
  texto.value = '';
  busqueda.limpiar();
  porConfirmar.value = null;
  errorAccion.value = '';
}

async function elegir(r) {
  // Contacto sin chat todavía (importados). Si es mío o no tiene dueño, lo abro
  // directo (crea la conversación). Si es de otro, pido confirmación para tomarlo.
  if (!r.conversacionId) {
    if (r.esMio || r.agenteActualId == null) {
      try {
        const conv = await acc.abrirContacto(r.contactoId, false);
        chat.abrir(conv);
        limpiar();
      } catch {
        errorAccion.value = 'No se pudo abrir el chat.';
      }
    } else {
      porConfirmar.value = r; // de otro → confirmar antes de tomar
    }
    return;
  }
  if (r.esMio || r.esGeneral) {
    chat.abrir(r.conversacion);
    limpiar();
  } else {
    porConfirmar.value = r; // pedir confirmación antes de tomar
  }
}

async function confirmarToma() {
  const r = porConfirmar.value;
  porConfirmar.value = null;
  errorAccion.value = '';
  try {
    let conv;
    if (!r.conversacionId) {
      // Sin chat aún: se crea la conversación y el agente se lo queda.
      conv = await acc.abrirContacto(r.contactoId, true);
    } else {
      // asignar → aplicarAsignacion ya recarga Míos; se actualiza el agenteId local
      // para que puedeVer pase al abrir.
      await acc.asignar(r.conversacionId, auth.agente.id);
      r.conversacion.agenteId = auth.agente.id;
      conv = r.conversacion;
    }
    chat.abrir(conv);
    limpiar();
  } catch {
    errorAccion.value = 'No se pudo tomar el chat.';
  }
}

async function iniciar() {
  const tel = soloDigitos(texto.value);
  errorAccion.value = '';
  try {
    await acc.crearContacto(tel, '');
    limpiar();
  } catch (e) {
    if (e.codigo === 'existe') {
      // El contacto ya existía: se re-busca para que el chat existente aparezca y se abra.
      errorAccion.value = 'Ese contacto ya existe — elígelo abajo.';
      await busqueda.buscar(tel);
    } else {
      errorAccion.value = 'No se pudo iniciar el chat.';
    }
  }
}

function onScrollLista(e) {
  const el = e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) conv.cargarMas();
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="p-2.5 pb-1">
      <div class="relative">
        <input v-model="texto" placeholder="Buscar por nombre o teléfono…"
          class="w-full bg-gray-100 rounded-full px-4 py-2 text-[13px] outline-none" />
        <button v-if="texto" class="absolute right-3 top-2 text-gray-400 text-sm" @click="limpiar">✕</button>
      </div>
    </div>

    <!-- Resultados de búsqueda -->
    <div v-if="busqueda.termino" class="flex-1 overflow-auto">
      <div v-if="errorAccion" class="px-3 py-2 text-[12px] text-red-500">{{ errorAccion }}</div>
      <div v-if="busqueda.buscando" class="p-4 text-center text-gray-400 text-sm">Buscando…</div>
      <template v-else>
        <div v-for="r in busqueda.resultados" :key="r.contactoId" @click="elegir(r)"
          class="px-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-[14px] text-gray-800 truncate">{{ r.nombre }}</div>
            <div class="text-[12px] text-gray-400">{{ r.telefono }}</div>
          </div>
          <span class="text-[11px] px-2 py-0.5 rounded-full shrink-0"
            :class="r.esMio ? 'bg-green-100 text-green-700' : r.esGeneral ? 'bg-gray-100 text-gray-600' : r.agenteActualNombre ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'">
            {{ r.esMio ? 'Tuyo' : r.esGeneral ? 'General' : r.agenteActualNombre ? ('de ' + r.agenteActualNombre) : 'Nuevo' }}
          </span>
        </div>
        <div v-if="!busqueda.resultados.length && soloDigitos(texto).length >= 10"
          @click="iniciar" class="px-3 py-3 cursor-pointer hover:bg-gray-50 text-marca-oscuro text-[13px] font-semibold">
          ＋ Iniciar chat con {{ soloDigitos(texto) }}
        </div>
        <div v-else-if="!busqueda.resultados.length" class="p-4 text-center text-gray-400 text-sm">Sin resultados.</div>
      </template>
    </div>

    <!-- Lista normal (cuando no se está buscando) -->
    <template v-else>
      <div class="flex gap-1 px-2.5 pb-1">
        <button class="flex-1 flex flex-col items-center py-1.5 rounded-lg leading-tight" :class="conv.bandeja === 'mias' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('mias')">
          <span class="text-[13px]">Míos</span>
          <span class="text-[11px] tabular-nums" :class="conv.bandeja === 'mias' ? 'text-white/75' : 'text-gray-400'">{{ conv.contadores.mias }}</span>
        </button>
        <button class="flex-1 flex flex-col items-center py-1.5 rounded-lg leading-tight" :class="conv.bandeja === 'resueltos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('resueltos')">
          <span class="text-[13px]">Resueltos</span>
          <span class="text-[11px] tabular-nums" :class="conv.bandeja === 'resueltos' ? 'text-white/75' : 'text-gray-400'">{{ conv.contadores.resueltos }}</span>
        </button>
        <button class="flex-1 flex flex-col items-center py-1.5 rounded-lg leading-tight" :class="conv.bandeja === 'general' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('general')">
          <span class="text-[13px]">General</span>
          <span class="text-[11px] tabular-nums" :class="conv.bandeja === 'general' ? 'text-white/75' : 'text-amber-600 font-medium'">{{ conv.contadores.general }}</span>
        </button>
        <button v-if="auth.esAdministrador" class="flex-1 flex flex-col items-center py-1.5 rounded-lg leading-tight" :class="conv.bandeja === 'todos' ? 'bg-marca text-white font-semibold' : 'text-gray-600'" @click="conv.cambiarBandeja('todos')">
          <span class="text-[13px]">Todos</span>
          <span class="text-[11px] tabular-nums" :class="conv.bandeja === 'todos' ? 'text-white/75' : 'text-gray-400'">{{ conv.contadores.todos }}</span>
        </button>
      </div>
      <div v-if="conv.bandeja === 'todos'" class="px-2.5 pb-1">
        <select :value="conv.agenteFiltro || ''" @change="conv.setAgenteFiltro($event.target.value ? Number($event.target.value) : null)"
          class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
          <option value="">Todos los agentes</option>
          <option v-for="a in acc.agentes" :key="a.id" :value="a.id">{{ a.nombre }}</option>
        </select>
      </div>
      <div class="px-2.5 pb-1">
        <button @click="conv.alternarNoLeidos()"
          class="text-[12px] px-2.5 py-1 rounded-full border inline-flex items-center gap-1"
          :class="conv.soloNoLeidos ? 'bg-marca text-white border-marca' : 'text-gray-500 border-gray-200'">
          ✉ No leídos
          <span v-if="conv.contadores.noLeidos[conv.bandeja]"
            class="px-1.5 rounded-full text-[10px] tabular-nums"
            :class="conv.soloNoLeidos ? 'bg-white/25' : 'bg-marca text-white'">{{ conv.contadores.noLeidos[conv.bandeja] }}</span>
        </button>
      </div>
      <div class="flex-1 overflow-auto" @scroll="onScrollLista">
        <div v-if="conv.cargando" class="p-4 text-center text-gray-400 text-sm">Cargando…</div>
        <div v-else-if="conv.error" class="p-4 text-center text-red-500 text-sm">{{ conv.error }}</div>
        <div v-else-if="!conv.items.length" class="p-4 text-center text-gray-400 text-sm">Sin conversaciones.</div>
        <ItemConversacion v-for="c in conv.items" :key="c.id" :conversacion="c" />
        <div v-if="conv.cargandoMas" class="p-2 text-center text-gray-400 text-[12px]">Cargando más…</div>
      </div>
    </template>

    <!-- Confirmación para tomar de otro agente -->
    <div v-if="porConfirmar" class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="porConfirmar = null">
      <div class="bg-white rounded-lg p-4 w-80 shadow-lg">
        <p class="text-[13px] text-gray-700 mb-3">
          Este chat lo atiende <b>{{ porConfirmar.agenteActualNombre || 'otro agente' }}</b>. ¿Tomarlo?
        </p>
        <div class="flex justify-end gap-2">
          <button class="text-[13px] text-gray-500 px-3 py-1.5" @click="porConfirmar = null">Cancelar</button>
          <button class="text-[13px] bg-marca text-white rounded-lg px-3 py-1.5 font-semibold" @click="confirmarToma">Tomarlo</button>
        </div>
      </div>
    </div>
  </div>
</template>
