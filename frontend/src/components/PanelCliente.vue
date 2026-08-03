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

// Estado de compra del contacto (¿compró?): '' = Seleccione, si/no/pendiente.
async function cambiarCompro(e) {
  const valor = e.target.value; // '' | 'si' | 'no' | 'pendiente'
  try {
    await acc.marcarCompro(c.value.contacto.id, valor);
  } catch {
    aviso.value = 'No se pudo guardar el estado de compra.';
  }
}

// El select refleja el agente actual (se sincroniza también con cambios en vivo).
const seleccion = ref('');
watch(() => c.value?.agenteId, (v) => { seleccion.value = v == null ? '' : v; }, { immediate: true });

onMounted(() => acc.cargarAgentes());
onMounted(() => acc.cargarEtiquetas());
watch(() => c.value?.id, (id) => { if (id) { acc.cargarNotas(id); acc.cargarAsignaciones(id); } }, { immediate: true });

const catalogo = computed(() => acc.catalogoEtiquetas);
const etqSel = computed(() => chat.etiquetas || []);
const estaPuesta = (e) => etqSel.value.some((x) => x.id === e.id);
async function alternar(e) { try { await acc.alternarEtiqueta(c.value.id, e); } catch { aviso.value = 'No se pudo etiquetar.'; } }

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

const esAdmin = computed(() => auth.esAdministrador);
async function archivar() {
  if (confirm('¿Archivar este chat? Saldrá de la bandeja y volverá si el cliente escribe.')) {
    try { await acc.archivarConversacion(c.value.id, !c.value.archivadaEn); } catch { aviso.value = 'No se pudo archivar.'; }
  }
}
async function desactivar() {
  if (confirm('¿Desactivar este contacto? Se ocultarán sus chats y no podrás escribirle.')) {
    try { await acc.desactivarContacto(c.value.contacto.id, c.value.id, !c.value.contacto?.desactivadoEn); } catch { aviso.value = 'No se pudo desactivar.'; }
  }
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

// --- Previsión (consulta a la BD externa olivosct por documento) ---
const prev = ref({ cargando: false, error: '', planes: null, pidiendoDoc: false });
const docInput = ref('');
const planSel = ref(null); // plan mostrado en el popup

// --- Mantenimientos (KARINGSOFT, SQL Server, por documento) ---
const mant = ref({ cargando: false, error: '', contratos: null, pidiendoDoc: false });
const docMant = ref('');
const mantSel = ref(null);

// Reiniciar al cambiar de contacto.
watch(() => c.value?.id, () => {
  prev.value = { cargando: false, error: '', planes: null, pidiendoDoc: false };
  docInput.value = '';
  planSel.value = null;
  mant.value = { cargando: false, error: '', contratos: null, pidiendoDoc: false };
  docMant.value = '';
  mantSel.value = null;
});

async function consultarMantenimientos(docOpcional) {
  if (!c.value?.contacto?.id) return;
  mant.value.cargando = true;
  mant.value.error = '';
  try {
    const r = await acc.consultarMantenimientos(c.value.contacto.id, docOpcional);
    if (r.codigo === 'sin_documento') { mant.value.pidiendoDoc = true; mant.value.contratos = null; }
    else { mant.value.pidiendoDoc = false; mant.value.contratos = r.contratos || []; }
  } catch (e) {
    mant.value.error = e.codigo === 'no_configurado'
      ? 'La consulta de mantenimientos no está configurada.'
      : 'No se pudo consultar mantenimientos.';
  } finally {
    mant.value.cargando = false;
  }
}
function enviarDocumentoMant() {
  const d = docMant.value.replace(/\D/g, '');
  if (d) consultarMantenimientos(d);
}
const CAMPOS_OCULTOS_MANT = new Set(['tercero', 'mantenimiento', 'mantenimiento_detalle']);
const columnasMant = computed(() => (mant.value.contratos && mant.value.contratos.length)
  ? Object.keys(mant.value.contratos[0]).filter((k) => !CAMPOS_OCULTOS_MANT.has(k))
  : []);

// --- Prenecesidad (KARINGSOFT, 2 consultas: contrato + saldos) ---
const pren = ref({ cargando: false, error: '', contratos: null, pidiendoDoc: false });
const docPren = ref('');
const prenSel = ref(null);
watch(() => c.value?.id, () => {
  pren.value = { cargando: false, error: '', contratos: null, pidiendoDoc: false };
  docPren.value = '';
  prenSel.value = null;
});
async function consultarPrenecesidad(docOpcional) {
  if (!c.value?.contacto?.id) return;
  pren.value.cargando = true;
  pren.value.error = '';
  try {
    const r = await acc.consultarPrenecesidad(c.value.contacto.id, docOpcional);
    if (r.codigo === 'sin_documento') { pren.value.pidiendoDoc = true; pren.value.contratos = null; }
    else { pren.value.pidiendoDoc = false; pren.value.contratos = r.contratos || []; }
  } catch (e) {
    pren.value.error = e.codigo === 'no_configurado'
      ? 'La consulta de prenecesidad no está configurada.'
      : 'No se pudo consultar prenecesidad.';
  } finally {
    pren.value.cargando = false;
  }
}
function enviarDocumentoPren() {
  const d = docPren.value.replace(/\D/g, '');
  if (d) consultarPrenecesidad(d);
}
const CAMPOS_OCULTOS_PREN = new Set(['tercero']);
const columnasPren = computed(() => (pren.value.contratos && pren.value.contratos.length)
  ? Object.keys(pren.value.contratos[0]).filter((k) => !CAMPOS_OCULTOS_PREN.has(k))
  : []);

async function consultarPrevision(docOpcional) {
  if (!c.value?.contacto?.id) return;
  prev.value.cargando = true;
  prev.value.error = '';
  try {
    const r = await acc.consultarPrevision(c.value.contacto.id, docOpcional);
    if (r.codigo === 'sin_documento') {
      prev.value.pidiendoDoc = true;
      prev.value.planes = null;
    } else {
      prev.value.pidiendoDoc = false;
      prev.value.planes = r.planes || [];
    }
  } catch (e) {
    prev.value.error = e.codigo === 'no_configurado'
      ? 'La consulta de previsión no está configurada.'
      : 'No se pudo consultar la previsión.';
  } finally {
    prev.value.cargando = false;
  }
}
function enviarDocumento() {
  const d = docInput.value.replace(/\D/g, '');
  if (d) consultarPrevision(d);
}

function etiquetaCampo(k) {
  return String(k).replace(/_/g, ' ').replace(/\bplan\b/gi, '').trim().replace(/^\w/, (m) => m.toUpperCase());
}
function formatoValor(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString('es-CO');
  return String(v);
}
// Campos que no se muestran en la tabla (auxiliares + ocultos por pedido).
const CAMPOS_OCULTOS = new Set([
  'concepto_desc', // auxiliar: se muestra dentro de la celda de concepto
  'anexo_plan', 'procesado_plan', 'fech_ini_plan', 'fech_gestion_plan',
  'estado_plan', 'tipo_plan', 'acuerdo_pago_plan',
  'ced_cobrador', 'meta_plan',
]);
const columnas = computed(() => (prev.value.planes && prev.value.planes.length)
  ? Object.keys(prev.value.planes[0]).filter((k) => !CAMPOS_OCULTOS.has(k))
  : []);
// Valor de celda: para concepto_plan muestra la descripción (id → nom_con) si existe.
function celda(p, k) {
  if (k === 'concepto_plan' && p.concepto_desc) return p.concepto_desc;
  return formatoValor(p[k]);
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

    <div class="py-2 border-t border-gray-100">
      <div class="text-[11px] text-gray-400 uppercase mb-1">¿Compró?</div>
      <select :value="c.contacto?.compro || ''" @change="cambiarCompro"
        class="w-full border rounded-lg px-2 py-1.5 text-[13px] font-semibold"
        :class="{
          'text-green-700 border-green-300 bg-green-50': c.contacto?.compro === 'si',
          'text-red-700 border-red-300 bg-red-50': c.contacto?.compro === 'no',
          'text-amber-700 border-amber-300 bg-amber-50': c.contacto?.compro === 'pendiente',
          'text-gray-500': !c.contacto?.compro,
        }">
        <option value="">Seleccione…</option>
        <option value="si">Sí</option>
        <option value="no">No</option>
        <option value="pendiente">Pendiente</option>
      </select>
    </div>

    <button v-if="!c.agenteId" @click="tomar" class="w-full mt-2 bg-marca text-white rounded-lg py-2 text-sm font-semibold">Tomar chat</button>
    <p v-if="aviso" class="text-[12px] text-red-600 text-center mt-1">{{ aviso }}</p>
    <div class="mt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Asignar a</div>
      <select v-model="seleccion" @change="asignarA" class="w-full border rounded-lg px-2 py-1.5 text-[13px]">
        <option value="">— Bandeja general —</option>
        <option v-for="a in acc.agentes" :key="a.id" :value="a.id">{{ a.nombre }}</option>
      </select>
    </div>

    <div class="mt-4 border-t border-gray-100 pt-3">
      <div class="text-[11px] text-gray-400 uppercase mb-1">Origen</div>
      <div class="flex flex-wrap gap-1.5 mb-2">
        <button v-for="e in catalogo.origen" :key="e.id" @click="alternar(e)"
          class="text-[12px] rounded-full px-2.5 py-1 border transition"
          :style="estaPuesta(e) ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color, color: e.color }">
          {{ e.nombre }}
        </button>
      </div>
      <div class="text-[11px] text-gray-400 uppercase mb-1">Interés</div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="e in catalogo.interes" :key="e.id" @click="alternar(e)"
          class="text-[12px] rounded-full px-2.5 py-1 border transition"
          :style="estaPuesta(e) ? { backgroundColor: e.color, borderColor: e.color, color: '#fff' } : { borderColor: e.color, color: e.color }">
          {{ e.nombre }}
        </button>
      </div>
    </div>

    <!-- Previsión -->
    <div class="mt-4">
      <button @click="consultarPrevision()" :disabled="prev.cargando"
        class="w-full border border-marca text-marca-oscuro rounded-lg py-2 text-sm font-semibold hover:bg-marca/5 disabled:opacity-60">
        {{ prev.cargando ? 'Consultando…' : '🔎 Consultar previsión' }}
      </button>
      <p v-if="prev.error" class="text-[12px] text-red-600 text-center mt-1">{{ prev.error }}</p>

      <!-- Pedir documento si el contacto no lo tiene -->
      <div v-if="prev.pidiendoDoc" class="mt-2 bg-amber-50 border border-amber-100 rounded p-2">
        <div class="text-[12px] text-gray-600 mb-1">Este contacto no tiene documento. Ingrésalo:</div>
        <div class="flex gap-1">
          <input v-model="docInput" @keydown.enter="enviarDocumento" placeholder="Cédula del pagador"
            inputmode="numeric" class="flex-1 border rounded px-2 py-1 text-[12px]" />
          <button @click="enviarDocumento" class="bg-marca text-white rounded px-2.5 text-[12px] font-semibold">Consultar</button>
        </div>
      </div>

      <!-- Lista de planes -->
      <div v-if="prev.planes" class="mt-2">
        <div v-if="!prev.planes.length" class="text-[12px] text-gray-400">Sin planes para este documento.</div>
        <template v-else>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Planes ({{ prev.planes.length }})</div>
          <button v-for="p in prev.planes" :key="p.num_plan" @click="planSel = p"
            class="w-full text-left border rounded px-2 py-1.5 text-[12.5px] hover:bg-gray-50 flex justify-between items-center mb-1">
            <span>Plan <b>{{ p.num_plan }}</b></span>
            <span class="text-gray-400 text-[11px]">ver ›</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Mantenimientos -->
    <div class="mt-3">
      <button @click="consultarMantenimientos()" :disabled="mant.cargando"
        class="w-full border border-marca text-marca-oscuro rounded-lg py-2 text-sm font-semibold hover:bg-marca/5 disabled:opacity-60">
        {{ mant.cargando ? 'Consultando…' : '🛠️ Consultar mantenimientos' }}
      </button>
      <p v-if="mant.error" class="text-[12px] text-red-600 text-center mt-1">{{ mant.error }}</p>

      <div v-if="mant.pidiendoDoc" class="mt-2 bg-amber-50 border border-amber-100 rounded p-2">
        <div class="text-[12px] text-gray-600 mb-1">Este contacto no tiene documento. Ingrésalo:</div>
        <div class="flex gap-1">
          <input v-model="docMant" @keydown.enter="enviarDocumentoMant" placeholder="Cédula del cliente"
            inputmode="numeric" class="flex-1 border rounded px-2 py-1 text-[12px]" />
          <button @click="enviarDocumentoMant" class="bg-marca text-white rounded px-2.5 text-[12px] font-semibold">Consultar</button>
        </div>
      </div>

      <div v-if="mant.contratos" class="mt-2">
        <div v-if="!mant.contratos.length" class="text-[12px] text-gray-400">Sin mantenimientos para este documento.</div>
        <template v-else>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Contratos ({{ mant.contratos.length }})</div>
          <button v-for="(m, i) in mant.contratos" :key="i" @click="mantSel = m"
            class="w-full text-left border rounded px-2 py-1.5 text-[12.5px] hover:bg-gray-50 mb-1">
            <div class="flex justify-between items-center">
              <span class="truncate">{{ m.servicio || 'Contrato' }} <span class="text-gray-400">#{{ m.contrato_documento }}</span></span>
              <span class="text-gray-400 text-[11px] shrink-0">ver ›</span>
            </div>
            <div class="text-[11px]" :class="String(m.estado_vigencia).startsWith('VIGENTE') ? 'text-green-600' : m.estado_vigencia === 'VENCIDO' ? 'text-red-600' : 'text-gray-400'">
              {{ m.estado_vigencia }}
            </div>
          </button>
        </template>
      </div>
    </div>

    <!-- Prenecesidad -->
    <div class="mt-3">
      <button @click="consultarPrenecesidad()" :disabled="pren.cargando"
        class="w-full border border-marca text-marca-oscuro rounded-lg py-2 text-sm font-semibold hover:bg-marca/5 disabled:opacity-60">
        {{ pren.cargando ? 'Consultando…' : '⚰️ Consultar prenecesidad' }}
      </button>
      <p v-if="pren.error" class="text-[12px] text-red-600 text-center mt-1">{{ pren.error }}</p>

      <div v-if="pren.pidiendoDoc" class="mt-2 bg-amber-50 border border-amber-100 rounded p-2">
        <div class="text-[12px] text-gray-600 mb-1">Este contacto no tiene documento. Ingrésalo:</div>
        <div class="flex gap-1">
          <input v-model="docPren" @keydown.enter="enviarDocumentoPren" placeholder="Cédula del cliente"
            inputmode="numeric" class="flex-1 border rounded px-2 py-1 text-[12px]" />
          <button @click="enviarDocumentoPren" class="bg-marca text-white rounded px-2.5 text-[12px] font-semibold">Consultar</button>
        </div>
      </div>

      <div v-if="pren.contratos" class="mt-2">
        <div v-if="!pren.contratos.length" class="text-[12px] text-gray-400">Sin prenecesidad para este documento.</div>
        <template v-else>
          <div class="text-[11px] text-gray-400 uppercase mb-1">Contratos ({{ pren.contratos.length }})</div>
          <button v-for="(p, i) in pren.contratos" :key="i" @click="prenSel = p"
            class="w-full text-left border rounded px-2 py-1.5 text-[12.5px] hover:bg-gray-50 mb-1 flex justify-between items-center">
            <span class="truncate"><b>{{ p.contrato }}</b><span v-if="p.nombre" class="text-gray-400"> · {{ p.nombre }}</span></span>
            <span class="text-gray-400 text-[11px] shrink-0">ver ›</span>
          </button>
        </template>
      </div>
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

    <!-- Acciones de administrador -->
    <div v-if="esAdmin" class="mt-4 border-t border-gray-100 pt-3 flex flex-col gap-2">
      <button @click="archivar" class="w-full border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">
        {{ c.archivadaEn ? 'Desarchivar chat' : '🗄️ Archivar chat' }}
      </button>
      <button @click="desactivar" class="w-full border border-red-200 text-red-600 rounded-lg py-2 text-sm hover:bg-red-50">
        {{ c.contacto?.desactivadoEn ? 'Reactivar contacto' : '🚫 Desactivar contacto' }}
      </button>
    </div>

    <!-- Popup: planes en tabla a lo ancho (con scroll horizontal) -->
    <Teleport to="body">
      <div v-if="planSel" class="fixed inset-0 bg-black/40 grid place-items-center z-[100] p-4" @click.self="planSel = null">
        <div class="bg-white rounded-lg shadow-lg w-full max-w-[95vw] max-h-[85vh] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <b class="text-gray-800">Previsión — {{ prev.planes?.length }} plan(es)</b>
            <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="planSel = null">✕</button>
          </div>
          <div class="overflow-auto p-3">
            <table class="text-[12px] border-collapse min-w-max">
              <thead>
                <tr class="text-left text-gray-500 bg-gray-50">
                  <th v-for="k in columnas" :key="k" class="px-2 py-1.5 border-b border-gray-200 whitespace-nowrap font-medium">{{ etiquetaCampo(k) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in prev.planes" :key="p.num_plan"
                  class="border-b border-gray-100 hover:bg-gray-50"
                  :class="p.num_plan === planSel.num_plan ? 'bg-marca/10' : ''">
                  <td v-for="k in columnas" :key="k" class="px-2 py-1 text-gray-800 align-top"
                    :class="k === 'novedad_plan' ? 'whitespace-normal min-w-[260px] max-w-[380px]' : 'whitespace-nowrap'">{{ celda(p, k) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Popup: mantenimientos en tabla a lo ancho -->
    <Teleport to="body">
      <div v-if="mantSel" class="fixed inset-0 bg-black/40 grid place-items-center z-[100] p-4" @click.self="mantSel = null">
        <div class="bg-white rounded-lg shadow-lg w-full max-w-[95vw] max-h-[85vh] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <b class="text-gray-800">Mantenimientos — {{ mant.contratos?.length }} contrato(s)</b>
            <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="mantSel = null">✕</button>
          </div>
          <div class="overflow-auto p-3">
            <table class="text-[12px] border-collapse min-w-max">
              <thead>
                <tr class="text-left text-gray-500 bg-gray-50">
                  <th v-for="k in columnasMant" :key="k" class="px-2 py-1.5 border-b border-gray-200 whitespace-nowrap font-medium">{{ etiquetaCampo(k) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in mant.contratos" :key="i" class="border-b border-gray-100 hover:bg-gray-50"
                  :class="m === mantSel ? 'bg-marca/10' : ''">
                  <td v-for="k in columnasMant" :key="k" class="px-2 py-1 text-gray-800 align-top whitespace-nowrap">{{ formatoValor(m[k]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Popup: prenecesidad en tabla a lo ancho -->
    <Teleport to="body">
      <div v-if="prenSel" class="fixed inset-0 bg-black/40 grid place-items-center z-[100] p-4" @click.self="prenSel = null">
        <div class="bg-white rounded-lg shadow-lg w-full max-w-[95vw] max-h-[85vh] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <b class="text-gray-800">Prenecesidad — {{ pren.contratos?.length }} contrato(s)</b>
            <button class="text-gray-400 hover:text-gray-700 text-xl leading-none" @click="prenSel = null">✕</button>
          </div>
          <div class="overflow-auto p-3">
            <table class="text-[12px] border-collapse min-w-max">
              <thead>
                <tr class="text-left text-gray-500 bg-gray-50">
                  <th v-for="k in columnasPren" :key="k" class="px-2 py-1.5 border-b border-gray-200 whitespace-nowrap font-medium">{{ etiquetaCampo(k) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in pren.contratos" :key="i" class="border-b border-gray-100 hover:bg-gray-50"
                  :class="p === prenSel ? 'bg-marca/10' : ''">
                  <td v-for="k in columnasPren" :key="k" class="px-2 py-1 text-gray-800 align-top"
                    :class="k === 'observacion' ? 'whitespace-normal min-w-[260px] max-w-[380px]' : 'whitespace-nowrap'">{{ formatoValor(p[k]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
