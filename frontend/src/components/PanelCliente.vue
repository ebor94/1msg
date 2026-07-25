<script setup>
import { computed, ref, watch, onMounted } from 'vue';
import { useChat } from '../stores/chat';
import { useAcciones } from '../stores/acciones';
import { useAuth } from '../stores/auth';
import { iniciales, horaCorta, etiquetaAsignacion } from '../utils/formato';

const chat = useChat();
const acc = useAcciones();
const auth = useAuth();
const c = computed(() => chat.conversacion);
const nombre = computed(() => c.value?.contacto?.nombreDisplay || c.value?.contacto?.nombreWa || c.value?.contacto?.telefono || 'Sin nombre');
const nuevaNota = ref('');
const aviso = ref('');
const mostrarHistorial = ref(false);

// El select refleja el agente actual (se sincroniza también con cambios en vivo).
const seleccion = ref('');
watch(() => c.value?.agenteId, (v) => { seleccion.value = v == null ? '' : v; }, { immediate: true });

onMounted(() => acc.cargarAgentes());
watch(() => c.value?.id, (id) => { if (id) { acc.cargarNotas(id); acc.cargarAsignaciones(id); } }, { immediate: true });

async function tomar() {
  aviso.value = '';
  try {
    await acc.tomar(c.value.id);
  } catch (e) {
    aviso.value = e.codigo === 'tomada' ? 'Otro agente ya tomó este chat.' : 'No se pudo tomar el chat.';
  }
}
async function asignarA() {
  const nuevo = seleccion.value === '' ? null : Number(seleccion.value);
  try {
    await acc.asignar(c.value.id, nuevo);
    // Si se reasignó a otro agente (o a general), ya no es tu chat activo: cerrar.
    if (nuevo !== auth.agente?.id) chat.cerrar();
  } catch { aviso.value = 'No se pudo reasignar.'; }
}
async function guardarNota() {
  const t = nuevaNota.value.trim();
  if (!t) return;
  nuevaNota.value = '';
  await acc.agregarNota(c.value.id, t);
}

const editando = ref(false);
const nombreEdit = ref('');
const guardandoNombre = ref(false);

function abrirEdicion() {
  nombreEdit.value = c.value?.contacto?.nombreDisplay || '';
  editando.value = true;
}
async function guardarNombre() {
  if (guardandoNombre.value) return;
  guardandoNombre.value = true;
  try {
    await acc.editarNombre(c.value.contacto.id, nombreEdit.value);
    editando.value = false;
  } catch {
    aviso.value = 'No se pudo guardar el nombre.';
  } finally {
    guardandoNombre.value = false;
  }
}
</script>

<template>
  <div v-if="!c" class="h-full grid place-items-center text-gray-300 text-sm p-4 text-center">
    Sin conversación seleccionada
  </div>
  <div v-else class="h-full overflow-auto p-4">
    <div class="w-16 h-16 rounded-full bg-gray-300 text-gray-700 grid place-items-center font-bold text-xl mx-auto mb-2">{{ iniciales(nombre) }}</div>
    <div v-if="!editando" class="flex items-center justify-center gap-1.5">
      <h4 class="text-center text-base text-gray-900 m-0">{{ nombre }}</h4>
      <button class="text-gray-400 hover:text-marca-oscuro text-sm" title="Editar nombre" @click="abrirEdicion">✎</button>
    </div>
    <div v-else class="flex flex-col items-center gap-1.5">
      <input v-model="nombreEdit" @keydown.enter="guardarNombre" placeholder="Nombre del contacto" maxlength="120"
        class="w-full border rounded px-2 py-1.5 text-[13px] text-center" />
      <div class="flex gap-2">
        <button class="text-[12px] text-gray-500 px-2 py-1" @click="editando = false">Cancelar</button>
        <button :disabled="guardandoNombre" class="text-[12px] bg-marca text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-60" @click="guardarNombre">
          {{ guardandoNombre ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </div>
    <div class="text-center text-gray-500 text-[12.5px] mb-4">{{ c.contacto?.telefono }}</div>
    <div class="text-[12.5px] text-gray-700 py-2 border-t border-gray-100 flex justify-between"><span class="text-gray-400">Estado</span><span class="capitalize">{{ c.estado }}</span></div>
    <div class="text-[12.5px] text-gray-700 py-2 border-t border-gray-100 flex justify-between"><span class="text-gray-400">Origen</span><span class="capitalize">{{ c.origen }}</span></div>

    <button v-if="!c.agenteId" @click="tomar" class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold">Tomar chat</button>
    <p v-if="aviso" class="text-[12px] text-red-600 text-center mt-1">{{ aviso }}</p>
    <div class="mt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Asignar a</div>
      <select v-model="seleccion" @change="asignarA" class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
        <option value="">— Bandeja general —</option>
        <option v-for="a in acc.agentes" :key="a.id" :value="a.id">{{ a.nombre }}</option>
      </select>
    </div>
    <!-- Notas internas: justo después de la asignación -->
    <div class="mt-4">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Notas internas</div>
      <div v-for="n in acc.notas" :key="n.id" class="bg-amber-50 border border-amber-100 rounded p-2 text-[12px] text-gray-700 mb-1">
        {{ n.nota }} <span class="text-gray-400">— {{ n.agente }}</span>
      </div>
      <div class="flex gap-1 mt-1">
        <input v-model="nuevaNota" @keydown.enter="guardarNota" placeholder="Agregar nota…" class="flex-1 border rounded px-2 py-1 text-[12px]" />
        <button @click="guardarNota" class="bg-gray-200 rounded px-2 text-[12px]">+</button>
      </div>
    </div>

    <!-- Historial de asignaciones: al fondo, colapsable (cerrado por defecto) -->
    <div v-if="acc.asignaciones.length" class="mt-4 border-t border-gray-100 pt-2">
      <button class="w-full flex items-center justify-between text-[11px] text-gray-400 uppercase hover:text-gray-600"
        @click="mostrarHistorial = !mostrarHistorial">
        <span>Historial de asignaciones ({{ acc.asignaciones.length }})</span>
        <span>{{ mostrarHistorial ? '▾' : '▸' }}</span>
      </button>
      <div v-if="mostrarHistorial" class="mt-2">
        <div v-for="a in acc.asignaciones" :key="a.id" class="text-[12px] text-gray-600 border-l-2 border-gray-200 pl-2 mb-1.5">
          <div>
            <b>{{ a.de || 'General' }}</b> → <b>{{ a.a || 'General' }}</b>
            <span class="text-gray-400">· {{ etiquetaAsignacion(a.tipo) }}</span>
          </div>
          <div class="text-[11px] text-gray-400">
            {{ horaCorta(a.creadoEn) }}<span v-if="a.ejecutadoPor"> · por {{ a.ejecutadoPor }}</span><span v-if="a.motivo"> · {{ a.motivo }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
