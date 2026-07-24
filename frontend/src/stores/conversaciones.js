import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useConversaciones = defineStore('conversaciones', {
  state: () => ({ bandeja: 'mias', items: [], cargando: false, error: '' }),
  actions: {
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      try {
        const r = await apiFetch(`/conversaciones?bandeja=${bandeja}`);
        this.items = r.conversaciones;
      } catch (e) {
        this.error = 'No se pudo cargar la bandeja.';
        this.items = [];
      } finally {
        this.cargando = false;
      }
    },
    cambiarBandeja(b) {
      if (b !== this.bandeja) this.cargar(b);
    },
  },
});
