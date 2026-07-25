import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useBusqueda = defineStore('busqueda', {
  state: () => ({ termino: '', resultados: [], buscando: false }),
  actions: {
    async buscar(termino) {
      this.termino = termino;
      const t = termino.trim();
      const digitos = t.replace(/\D/g, '');
      if (t.length < 2 && digitos.length < 3) { this.resultados = []; return; }
      this.buscando = true;
      try {
        const r = await apiFetch(`/contactos/buscar?q=${encodeURIComponent(t)}`);
        // Guard: descarta la respuesta si el término cambió mientras estaba en vuelo.
        if (this.termino.trim() === t) this.resultados = r.resultados;
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
