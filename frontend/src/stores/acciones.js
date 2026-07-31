import { defineStore } from 'pinia';
import { apiFetch, tokenGuardado } from '../api/cliente';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

export const useAcciones = defineStore('acciones', {
  state: () => ({
    agentes: [], notas: [], notasConvId: null, error: '', plantillas: [],
    asignaciones: [], asignacionesConvId: null,
  }),
  actions: {
    async cargarAgentes() {
      try { this.agentes = (await apiFetch('/agentes')).agentes; } catch { this.agentes = []; }
    },
    async cargarTotalesAgentes() {
      return (await apiFetch('/agentes/totales')).agentes;
    },
    async consultarPrevision(contactoId, documento) {
      const q = documento ? `?documento=${encodeURIComponent(documento)}` : '';
      return apiFetch(`/contactos/${contactoId}/prevision${q}`);
    },
    async consultarMantenimientos(contactoId, documento) {
      const q = documento ? `?documento=${encodeURIComponent(documento)}` : '';
      return apiFetch(`/contactos/${contactoId}/mantenimientos${q}`);
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
