import { defineStore } from 'pinia';

const CLAVE = 'wa_notif';

// Notificación de escritorio del navegador para entrantes. Preferencia por
// dispositivo (localStorage), apagada por defecto (requiere permiso). El propio
// navegador crea el popup; nada sale de aquí.
export const useNotificaciones = defineStore('notificaciones', {
  state: () => ({ activado: localStorage.getItem(CLAVE) === '1' }),
  getters: {
    soportado() { return typeof window !== 'undefined' && 'Notification' in window; },
    permiso() { return this.soportado ? Notification.permission : 'denied'; },
    bloqueado() { return this.permiso === 'denied'; },
  },
  actions: {
    async activar() {
      if (!this.soportado || this.bloqueado) return;
      // requestPermission DEBE ir en un gesto del usuario (el clic del toggle).
      const permiso = await Notification.requestPermission();
      if (permiso === 'granted') { this.activado = true; localStorage.setItem(CLAVE, '1'); }
    },
    desactivar() { this.activado = false; localStorage.setItem(CLAVE, '0'); },
    async alternar() { if (this.activado) this.desactivar(); else await this.activar(); },
    mostrar({ conversacionId, titulo, cuerpo, onAbrir, omitirFoco }) {
      if (!this.activado || this.permiso !== 'granted') return;
      // No molestar con un popup del SO si el agente ya está mirando la bandeja
      // (salvo omitirFoco: para eventos que deben verse siempre, p. ej. una asignación).
      if (!omitirFoco && typeof document !== 'undefined' && document.hasFocus && document.hasFocus()) return;
      try {
        const n = new Notification(titulo, { body: cuerpo, tag: `wa-conv-${conversacionId}` });
        n.onclick = () => {
          try { window.focus(); } catch { /* ignore */ }
          if (typeof onAbrir === 'function') onAbrir();
          n.close();
        };
      } catch { /* algunos navegadores lanzan en contextos raros; no romper el socket */ }
    },
  },
});
