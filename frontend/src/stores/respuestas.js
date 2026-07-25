import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useRespuestas = defineStore('respuestas', {
  state: () => ({ items: [], cargadas: false }),
  actions: {
    async cargar() {
      try {
        this.items = (await apiFetch('/respuestas')).respuestas;
        this.cargadas = true;
      } catch {
        this.items = [];
      }
    },
    async crear(titulo, texto) {
      const r = await apiFetch('/respuestas', { method: 'POST', body: JSON.stringify({ titulo, texto }) });
      this.items.push(r.respuesta);
    },
    async actualizar(id, titulo, texto) {
      const r = await apiFetch(`/respuestas/${id}`, { method: 'PATCH', body: JSON.stringify({ titulo, texto }) });
      const i = this.items.findIndex((x) => x.id === id);
      if (i !== -1) this.items[i] = r.respuesta;
    },
    async eliminar(id) {
      await apiFetch(`/respuestas/${id}`, { method: 'DELETE' });
      this.items = this.items.filter((x) => x.id !== id);
    },
  },
});
