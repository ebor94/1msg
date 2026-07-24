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
      try {
        const r = await apiFetch(`/conversaciones/${conversacion.id}/mensajes`);
        this.mensajes = r.mensajes;
        await apiFetch(`/conversaciones/${conversacion.id}/leer`, { method: 'POST' });
        this.marcarLeidaEnLista(conversacion.id);
      } catch (e) {
        this.error = 'No se pudo abrir la conversación.';
      } finally {
        this.cargando = false;
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
