import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

export const useAcciones = defineStore('acciones', {
  state: () => ({ agentes: [], notas: [], error: '' }),
  actions: {
    async cargarAgentes() {
      try { this.agentes = (await apiFetch('/agentes')).agentes; } catch { this.agentes = []; }
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
      try { this.notas = (await apiFetch(`/conversaciones/${convId}/notas`)).notas; } catch { this.notas = []; }
    },
    async agregarNota(convId, texto) {
      const r = await apiFetch(`/conversaciones/${convId}/notas`, { method: 'POST', body: JSON.stringify({ nota: texto }) });
      this.notas.push(r.nota);
    },
    async crearContacto(telefono, nombre) {
      return (await apiFetch('/contactos', { method: 'POST', body: JSON.stringify({ telefono, nombre }) })).contacto;
    },
  },
});
