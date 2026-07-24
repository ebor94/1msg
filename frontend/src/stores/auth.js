import { defineStore } from 'pinia';
import { apiFetch, CLAVE_TOKEN } from '../api/cliente';

export const useAuth = defineStore('auth', {
  state: () => ({ token: null, agente: null }),
  getters: {
    estaAutenticado: (s) => !!s.token,
    esAdministrador: (s) => s.agente?.rol === 'administrador',
  },
  actions: {
    async login(usuario, clave) {
      const r = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, clave }),
      });
      this.token = r.token;
      this.agente = r.agente;
      localStorage.setItem(CLAVE_TOKEN, r.token);
    },
    cargarDeStorage() {
      const t = localStorage.getItem(CLAVE_TOKEN);
      if (t) this.token = t;
    },
    async cargarAgente() {
      if (!this.token) return;
      try {
        const r = await apiFetch('/auth/me');
        this.agente = r.agente;
      } catch (e) {
        this.logout();
      }
    },
    logout() {
      this.token = null;
      this.agente = null;
      localStorage.removeItem(CLAVE_TOKEN);
    },
  },
});
