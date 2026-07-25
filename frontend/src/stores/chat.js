import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';
import { useConversaciones } from './conversaciones';

export const useChat = defineStore('chat', {
  state: () => ({
    conversacion: null,
    mensajes: [],
    cargando: false,
    error: '',
    enviando: false,
    errorEnvio: '',
    recuperando: false,
    hayMas: false,
    cargandoMas: false,
  }),
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
        this.hayMas = r.mensajes.length === 30;
        await apiFetch(`/conversaciones/${id}/leer`, { method: 'POST' });
        if (!sigueActual()) return;
        this.marcarLeidaEnLista(id);
        this.recuperarHistorial(id); // en segundo plano
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
    async recuperarHistorial(id) {
      this.recuperando = true;
      try {
        const r = await apiFetch(`/conversaciones/${id}/historial`, { method: 'POST' });
        if (this.conversacion?.id !== id) return;
        if (r.recuperados > 0) {
          const rm = await apiFetch(`/conversaciones/${id}/mensajes`);
          if (this.conversacion?.id === id) {
            this.mensajes = rm.mensajes;
            this.hayMas = rm.mensajes.length === 30;
          }
        }
      } catch {
        /* el historial es best-effort: si falla, se conserva lo local */
      } finally {
        if (this.conversacion?.id === id) this.recuperando = false;
      }
    },
    async cargarMas() {
      if (!this.conversacion || !this.hayMas || this.cargandoMas) return;
      const id = this.conversacion.id;
      const primero = this.mensajes[0];
      if (!primero) return;
      this.cargandoMas = true;
      try {
        const qs = `antesDeTs=${encodeURIComponent(primero.tsProveedor)}&antesDeId=${primero.id}`;
        const r = await apiFetch(`/conversaciones/${id}/mensajes?${qs}`);
        if (this.conversacion?.id !== id) return;
        if (r.mensajes.length < 30) this.hayMas = false;
        if (r.mensajes.length) this.mensajes = [...r.mensajes, ...this.mensajes];
      } finally {
        if (this.conversacion?.id === id) this.cargandoMas = false;
      }
    },
    cerrar() {
      this.conversacion = null;
      this.mensajes = [];
      this.hayMas = false;
      this.recuperando = false;
    },
  },
});
