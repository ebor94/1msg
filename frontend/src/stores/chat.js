import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useConversaciones } from './conversaciones';

export const useChat = defineStore('chat', {
  state: () => ({ conversacion: null, mensajes: [], cargando: false, error: '' }),
  actions: {
    async abrir(conversacion) {
      this.conversacion = conversacion;
      this.mensajes = [];
      this.cargando = true;
      this.error = '';
      // Guard contra clics rápidos: si el agente cambió de chat mientras esta
      // petición estaba en vuelo, descartamos su resultado para no pintar los
      // mensajes de una conversación bajo el nombre de otra.
      const id = conversacion.id;
      const sigueActual = () => this.conversacion && this.conversacion.id === id;
      try {
        const r = await apiFetch(`/conversaciones/${id}/mensajes`);
        if (!sigueActual()) return;
        this.mensajes = r.mensajes;
        await apiFetch(`/conversaciones/${id}/leer`, { method: 'POST' });
        if (!sigueActual()) return;
        this.marcarLeidaEnLista(id);
      } catch (e) {
        if (sigueActual()) this.error = 'No se pudo abrir la conversación.';
      } finally {
        if (sigueActual()) this.cargando = false;
      }
    },
    marcarLeidaEnLista(id) {
      if (this.conversacion) this.conversacion.noLeidos = 0;
      const item = useConversaciones().items.find((c) => c.id === id);
      if (item) item.noLeidos = 0;
    },
    cerrar() {
      this.conversacion = null;
      this.mensajes = [];
    },
  },
});
