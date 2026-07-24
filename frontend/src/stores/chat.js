import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useConversaciones } from './conversaciones';

export const useChat = defineStore('chat', {
  state: () => ({ conversacion: null, mensajes: [], cargando: false, error: '', enviando: false, errorEnvio: '' }),
  actions: {
    async enviar(texto) {
      if (!this.conversacion) return;
      const convId = this.conversacion.id;
      this.enviando = true;
      this.errorEnvio = '';
      try {
        const r = await apiFetch(`/conversaciones/${convId}/mensajes`, {
          method: 'POST',
          body: JSON.stringify({ texto }),
        });
        if (this.conversacion && this.conversacion.id === convId) this.mensajes.push(r.mensaje);
        const item = useConversaciones().items.find((c) => c.id === convId);
        if (item) {
          item.ultimoMensajeTexto = r.mensaje.texto;
          item.ultimoMensajeEn = r.mensaje.tsProveedor;
          item.ultimoMensajeDir = 'out';
        }
      } catch (e) {
        this.errorEnvio = e.codigo === 'fuera_de_ventana' ? 'La ventana de 24h está cerrada.' : 'No se pudo enviar.';
      } finally {
        this.enviando = false;
      }
    },
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
