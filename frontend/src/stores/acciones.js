import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

export const useAcciones = defineStore('acciones', {
  state: () => ({ agentes: [], notas: [], notasConvId: null, error: '', plantillas: [] }),
  actions: {
    async cargarAgentes() {
      try { this.agentes = (await apiFetch('/agentes')).agentes; } catch { this.agentes = []; }
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
  },
});
