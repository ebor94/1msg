import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useBusqueda = defineStore('busqueda', {
  state: () => ({ termino: '', resultados: [], buscando: false }),
  actions: {
    async buscar(telefono) {
      this.termino = telefono;
      const t = telefono.replace(/\D/g, '');
      if (t.length < 3) { this.resultados = []; return; }
      this.buscando = true;
      try {
        const r = await apiFetch(`/contactos/buscar?telefono=${encodeURIComponent(t)}`);
        // Guard: descarta la respuesta si el término cambió mientras estaba en vuelo.
        if (this.termino.replace(/\D/g, '') === t) this.resultados = r.resultados;
      } catch {
        this.resultados = [];
      } finally {
        this.buscando = false;
      }
    },
    limpiar() {
      this.termino = '';
      this.resultados = [];
      this.buscando = false;
    },
  },
});
