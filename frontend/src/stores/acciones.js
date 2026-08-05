import { defineStore } from 'pinia';
import { apiFetch, tokenGuardado } from '../api/cliente';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';
import { siguienteSeleccion } from '../utils/etiquetas';

export const useAcciones = defineStore('acciones', {
  state: () => ({
    agentes: [], notas: [], notasConvId: null, error: '', plantillas: [],
    asignaciones: [], asignacionesConvId: null,
    catalogoEtiquetas: { origen: [], interes: [] },
  }),
  actions: {
    async cargarAgentes() {
      try { this.agentes = (await apiFetch('/agentes')).agentes; } catch { this.agentes = []; }
    },
    async cargarTotalesAgentes() {
      return (await apiFetch('/agentes/totales')).agentes;
    },
    async cargarEstadisticas(desde, hasta) {
      const q = new URLSearchParams();
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);
      const r = await apiFetch(`/etiquetas/estadisticas?${q.toString()}`);
      return r.estadisticas;
    },
    async consultarPrevision(contactoId, documento) {
      const q = documento ? `?documento=${encodeURIComponent(documento)}` : '';
      return apiFetch(`/contactos/${contactoId}/prevision${q}`);
    },
    async cargarConceptosPrevision() {
      return (await apiFetch('/prevision/conceptos')).conceptos;
    },
    async registrarGestionPrevision(payload) {
      return apiFetch('/prevision/gestion', { method: 'POST', body: JSON.stringify(payload) });
    },
    async consultarMantenimientos(contactoId, documento) {
      const q = documento ? `?documento=${encodeURIComponent(documento)}` : '';
      return apiFetch(`/contactos/${contactoId}/mantenimientos${q}`);
    },
    async consultarPrenecesidad(contactoId, documento) {
      const q = documento ? `?documento=${encodeURIComponent(documento)}` : '';
      return apiFetch(`/contactos/${contactoId}/prenecesidad${q}`);
    },
    async consultarProductos(documento) {
      return apiFetch(`/productos?documento=${encodeURIComponent(documento)}`);
    },
    async cargarInforme(filtros = {}) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) {
        if (v !== '' && v != null) q.set(k, v);
      }
      return apiFetch(`/contactos/informe?${q.toString()}`);
    },
    async cargarEtiquetas() {
      if (this.catalogoEtiquetas.origen.length || this.catalogoEtiquetas.interes.length) return this.catalogoEtiquetas;
      this.catalogoEtiquetas = await apiFetch('/etiquetas');
      return this.catalogoEtiquetas;
    },
    async cargarCatalogoAdmin() {
      return apiFetch('/etiquetas/todas');
    },
    async crearEtiqueta(datos) {
      const r = await apiFetch('/etiquetas', { method: 'POST', body: JSON.stringify(datos) });
      this.catalogoEtiquetas = { origen: [], interes: [] }; // invalida cache de agentes
      return r.etiqueta;
    },
    async actualizarEtiqueta(id, cambios) {
      const r = await apiFetch(`/etiquetas/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
      this.catalogoEtiquetas = { origen: [], interes: [] };
      return r.etiqueta;
    },
    async alternarEtiqueta(convId, etiqueta) {
      const chat = useChat();
      const previa = chat.etiquetas || [];
      const puesta = previa.some((e) => e.id === etiqueta.id);
      chat.etiquetas = siguienteSeleccion(previa, etiqueta); // optimista (regla 1-origen en UI)
      try {
        if (puesta) {
          await apiFetch(`/conversaciones/${convId}/etiquetas/${etiqueta.id}`, { method: 'DELETE' });
        } else {
          const r = await apiFetch(`/conversaciones/${convId}/etiquetas`, {
            method: 'POST', body: JSON.stringify({ etiquetaId: etiqueta.id }),
          });
          chat.etiquetas = r.etiquetas; // autoritativo: confirma la regla 1-origen del backend
        }
      } catch (e) {
        chat.etiquetas = previa; // revertir si el request falla
        throw e;
      }
    },
    async cargarPlantillas() {
      try { this.plantillas = (await apiFetch('/plantillas')).plantillas; } catch { this.plantillas = []; }
    },
    async enviarPlantilla(convId, cuerpo) {
      const r = await apiFetch(`/conversaciones/${convId}/plantilla`, { method: 'POST', body: JSON.stringify(cuerpo) });
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId && !chat.mensajes.some((m) => m.id === r.mensaje.id)) {
        chat.mensajes.push(r.mensaje);
      }
      return r.mensaje;
    },
    async tomar(convId) {
      const r = await apiFetch(`/conversaciones/${convId}/tomar`, { method: 'POST' });
      this.aplicarAsignacion(convId, r.conversacion.agenteId);
    },
    async asignar(convId, agenteId) {
      const r = await apiFetch(`/conversaciones/${convId}/asignar`, { method: 'POST', body: JSON.stringify({ agenteId }) });
      this.aplicarAsignacion(convId, r.conversacion.agenteId);
    },
    aplicarAsignacion(convId, agenteId) {
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId) chat.conversacion.agenteId = agenteId;
      useConversaciones().cargar();
    },
    async cargarNotas(convId) {
      // Guard anti-carrera: descarta la respuesta si ya cambiaron de chat.
      this.notasConvId = convId;
      try {
        const r = await apiFetch(`/conversaciones/${convId}/notas`);
        if (this.notasConvId === convId) this.notas = r.notas;
      } catch {
        if (this.notasConvId === convId) this.notas = [];
      }
    },
    async cargarAsignaciones(convId) {
      // Guard anti-carrera: descarta la respuesta si ya cambiaron de chat.
      this.asignacionesConvId = convId;
      this.asignaciones = []; // no dejar visible el historial del chat anterior
      try {
        const r = await apiFetch(`/conversaciones/${convId}/asignaciones`);
        if (this.asignacionesConvId === convId) this.asignaciones = r.asignaciones;
      } catch {
        if (this.asignacionesConvId === convId) this.asignaciones = [];
      }
    },
    async agregarNota(convId, texto) {
      const r = await apiFetch(`/conversaciones/${convId}/notas`, { method: 'POST', body: JSON.stringify({ nota: texto }) });
      this.notas.push(r.nota);
    },
    async crearContacto(telefono, nombre) {
      const r = await apiFetch('/contactos', { method: 'POST', body: JSON.stringify({ telefono, nombre }) });
      // Aparece en Míos (la conversación se creó asignada al agente) y se abre.
      const conv = useConversaciones();
      await conv.cargar('mias');
      useChat().abrir(r.conversacion);
      return r.conversacion;
    },
    // Abre (crea) la conversación de un contacto que ya existe pero no tiene chat
    // todavía (importados con dueño). `tomar` = quedárselo aunque sea de otro.
    async abrirContacto(contactoId, tomar = false) {
      const r = await apiFetch(`/contactos/${contactoId}/conversacion`, {
        method: 'POST', body: JSON.stringify({ tomar }),
      });
      await useConversaciones().cargar('mias');
      return r.conversacion;
    },
    async enviarMedia(convId, file, caption, voz) {
      const fd = new FormData();
      fd.append('archivo', file);
      if (caption) fd.append('caption', caption);
      if (voz) fd.append('voz', '1');
      const token = tokenGuardado();
      const resp = await fetch(`/api/conversaciones/${convId}/media`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      let cuerpo = null;
      try { cuerpo = await resp.json(); } catch { /* sin cuerpo */ }
      if (!resp.ok) {
        const e = new Error((cuerpo && cuerpo.error) || `error ${resp.status}`);
        e.status = resp.status;
        if (cuerpo && cuerpo.codigo) e.codigo = cuerpo.codigo;
        throw e;
      }
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId && !chat.mensajes.some((m) => m.id === cuerpo.mensaje.id)) {
        chat.mensajes.push(cuerpo.mensaje);
      }
      return cuerpo.mensaje;
    },
    async marcarNoLeido(convId) {
      await apiFetch(`/conversaciones/${convId}/no-leido`, { method: 'POST' });
      const item = useConversaciones().items.find((c) => c.id === convId);
      if (item) item.noLeidos = Math.max(item.noLeidos || 0, 1);
      const chat = useChat();
      if (chat.conversacion && chat.conversacion.id === convId) chat.conversacion.noLeidos = Math.max(chat.conversacion.noLeidos || 0, 1);
    },
    async resolver(convId) {
      await apiFetch(`/conversaciones/${convId}/resolver`, { method: 'POST' });
      const conv = useConversaciones();
      // Sale de las bandejas activas; en Resueltos/Todos permanece.
      if (conv.bandeja !== 'resueltos' && conv.bandeja !== 'todos') {
        const i = conv.items.findIndex((c) => c.id === convId);
        if (i !== -1) conv.items.splice(i, 1);
      }
      conv.cargarContadores(); // Míos baja, Resueltos sube
    },
    async archivarConversacion(convId, archivar = true) {
      await apiFetch(`/conversaciones/${convId}/${archivar ? 'archivar' : 'desarchivar'}`, { method: 'POST' });
      const conv = useConversaciones();
      const i = conv.items.findIndex((c) => c.id === convId);
      if (i !== -1) conv.items.splice(i, 1);
      const chat = useChat();
      if (chat.conversacion?.id === convId) chat.cerrar();
      conv.cargarContadores();
    },
    async desactivarContacto(contactoId, convId, desactivar = true) {
      await apiFetch(`/contactos/${contactoId}/${desactivar ? 'desactivar' : 'reactivar'}`, { method: 'POST' });
      const chat = useChat();
      if (chat.conversacion?.id === convId) chat.cerrar();
      // Recarga autoritativa: desactivar oculta TODAS las conversaciones del contacto,
      // no solo `convId` (y en "Ver ocultos" un contacto reactivado debe desaparecer de ahí).
      // cargar() ya refresca los contadores en paralelo.
      await useConversaciones().cargar();
    },
    async marcarCompro(contactoId, compro) {
      const r = await apiFetch(`/contactos/${contactoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ compro }),
      });
      const nuevo = r.contacto.compro;
      const chat = useChat();
      if (chat.conversacion?.contacto?.id === contactoId) chat.conversacion.contacto.compro = nuevo;
      const item = useConversaciones().items.find((c) => c.contacto?.id === contactoId);
      if (item?.contacto) item.contacto.compro = nuevo;
      return nuevo;
    },
    async editarNombre(contactoId, nombre) {
      const r = await apiFetch(`/contactos/${contactoId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombreDisplay: nombre }),
      });
      const nuevo = r.contacto.nombreDisplay;
      const chat = useChat();
      if (chat.conversacion?.contacto?.id === contactoId) chat.conversacion.contacto.nombreDisplay = nuevo;
      const item = useConversaciones().items.find((c) => c.contacto?.id === contactoId);
      if (item?.contacto) item.contacto.nombreDisplay = nuevo;
      return nuevo;
    },
  },
});
