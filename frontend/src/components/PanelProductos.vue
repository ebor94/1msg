<script setup>
import { ref } from 'vue';
import { useAcciones } from '../stores/acciones';
import { etiquetaCampo, formatoCelda } from '../utils/tablas';

const emit = defineEmits(['cerrar']);
const acc = useAcciones();

const documento = ref('');
const datos = ref(null);
const cargando = ref(false);
const error = ref('');

async function consultar() {
  const doc = documento.value.replace(/\D/g, '');
  if (!doc) { error.value = 'Ingresa una cédula.'; return; }
  cargando.value = true; error.value = ''; datos.value = null;
  try { datos.value = await acc.consultarProductos(doc); }
  catch (e) { error.value = e.message || 'No se pudo consultar.'; }
  finally { cargando.value = false; }
}

const SECCIONES = [
  { key: 'prevision', titulo: 'Previsión' },
  { key: 'mantenimientos', titulo: 'Mantenimientos' },
  { key: 'prenecesidad', titulo: 'Prenecesidad' },
];
const columnas = (datos) => (datos && datos.length ? Object.keys(datos[0]) : []);
</script>

<template>
  <div class="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" @click.self="emit('cerrar')">
    <div class="bg-white rounded-lg shadow-lg w-full max-w-5xl max-h-[88vh] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <b class="text-gray-800">Consultar productos</b>
        <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="emit('cerrar')">✕</button>
      </div>

      <div class="flex items-center gap-2 px-4 py-3 border-b">
        <input v-model="documento" inputmode="numeric" placeholder="Cédula del cliente"
          class="flex-1 border rounded px-3 py-1.5 text-[13px]" @keyup.enter="consultar" />
        <button class="bg-marca text-white rounded-lg px-4 py-1.5 font-semibold text-[13px]" @click="consultar">Consultar</button>
      </div>

      <div class="overflow-auto p-4">
        <div v-if="cargando" class="text-center text-gray-400 text-sm py-6">Consultando…</div>
        <div v-else-if="error" class="text-center text-red-500 text-sm py-6">{{ error }}</div>
        <div v-else-if="!datos" class="text-center text-gray-400 text-sm py-6">Ingresa una cédula y pulsa Consultar.</div>
        <template v-else>
          <div v-for="s in SECCIONES" :key="s.key" class="mb-5">
            <div class="text-[13px] font-semibold text-marca-oscuro mb-1">{{ s.titulo }}</div>
            <div v-if="datos[s.key].estado === 'no_configurado'" class="text-[12px] text-gray-400">No configurado.</div>
            <div v-else-if="datos[s.key].estado === 'error'" class="text-[12px] text-red-500">No se pudo consultar.</div>
            <div v-else-if="!datos[s.key].datos || !datos[s.key].datos.length" class="text-[12px] text-gray-400">Sin resultados.</div>
            <div v-else class="overflow-x-auto border rounded">
              <table class="w-full text-[12px]">
                <thead class="bg-gray-50 text-gray-500">
                  <tr>
                    <th v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1.5 border-b whitespace-nowrap font-medium text-left">{{ etiquetaCampo(k) }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in datos[s.key].datos" :key="i" class="border-b border-gray-100 hover:bg-gray-50">
                    <td v-for="k in columnas(datos[s.key].datos)" :key="k" class="px-2 py-1 text-gray-800 align-top"
                      :class="/observ/i.test(k) ? 'whitespace-normal min-w-[220px] max-w-[360px]' : 'whitespace-nowrap'">{{ formatoCelda(k, row[k]) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
