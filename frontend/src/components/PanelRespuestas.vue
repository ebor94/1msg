<script setup>
import { ref, onMounted } from 'vue';
import { useRespuestas } from '../stores/respuestas';

const emit = defineEmits(['elegir', 'cerrar']);
const resp = useRespuestas();

const editando = ref(null); // null | 'nueva' | id
const titulo = ref('');
const texto = ref('');
const guardando = ref(false);
const error = ref('');

onMounted(() => { if (!resp.cargadas) resp.cargar(); });

function nueva() { editando.value = 'nueva'; titulo.value = ''; texto.value = ''; error.value = ''; }
function editar(r) { editando.value = r.id; titulo.value = r.titulo; texto.value = r.texto; error.value = ''; }
function cancelar() { editando.value = null; error.value = ''; }

async function guardar() {
  const t = titulo.value.trim();
  const x = texto.value.trim();
  if (!t || !x) { error.value = 'Título y texto son obligatorios.'; return; }
  guardando.value = true;
  try {
    if (editando.value === 'nueva') await resp.crear(t, x);
    else await resp.actualizar(editando.value, t, x);
    editando.value = null;
  } catch {
    error.value = 'No se pudo guardar.';
  } finally {
    guardando.value = false;
  }
}
async function borrar(r) {
  if (!window.confirm(`¿Borrar "${r.titulo}"?`)) return;
  try { await resp.eliminar(r.id); } catch { /* noop */ }
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg p-4 w-[420px] max-h-[80vh] overflow-auto shadow-lg">
      <div class="flex justify-between items-center mb-3">
        <h3 class="text-sm font-semibold text-gray-800">Respuestas rápidas</h3>
        <button class="text-gray-400 text-sm" @click="emit('cerrar')">✕</button>
      </div>

      <!-- Formulario crear/editar -->
      <div v-if="editando !== null" class="mb-3 border-b border-gray-100 pb-3">
        <input v-model="titulo" maxlength="80" placeholder="Título (ej. Saludo)" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2" />
        <textarea v-model="texto" maxlength="2000" rows="3" placeholder="Texto de la respuesta…" class="w-full border rounded px-2 py-1.5 text-[13px] mb-2"></textarea>
        <div v-if="error" class="text-[12px] text-red-500 mb-2">{{ error }}</div>
        <div class="flex justify-end gap-2">
          <button class="text-[12px] text-gray-500 px-2 py-1" @click="cancelar">Cancelar</button>
          <button :disabled="guardando" class="text-[12px] bg-marca text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-60" @click="guardar">
            {{ guardando ? 'Guardando…' : 'Guardar' }}
          </button>
        </div>
      </div>

      <!-- Lista -->
      <button v-if="editando === null" class="text-[12px] text-marca-oscuro font-semibold mb-2" @click="nueva">＋ Nueva respuesta</button>
      <div v-for="r in resp.items" :key="r.id" class="border-b border-gray-100 py-2 flex items-start gap-2">
        <div class="flex-1 min-w-0 cursor-pointer" @click="emit('elegir', r.texto)">
          <div class="text-[13px] font-medium text-gray-800">{{ r.titulo }}</div>
          <div class="text-[12px] text-gray-500 line-clamp-2">{{ r.texto }}</div>
        </div>
        <button class="text-gray-400 text-xs" title="Editar" @click="editar(r)">✎</button>
        <button class="text-gray-400 text-xs" title="Borrar" @click="borrar(r)">🗑</button>
      </div>
      <div v-if="!resp.items.length && editando === null" class="text-center text-gray-400 text-sm py-4">
        Aún no tienes respuestas. Crea una con "＋ Nueva".
      </div>
    </div>
  </div>
</template>
