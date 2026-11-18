import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

// Estado del banner de mantenimiento/proveedor. Se sondea cada ~45 s para que el
// banner automático (1msg caído) aparezca/desaparezca sin recargar la página.
export const useMantenimiento = defineStore('mantenimiento', {
  state: () => ({ activo: false, mensaje: '', origen: null, proveedor: 'up', manual: false, _timer: null }),
  actions: {
    async cargar() {
      try {
        const r = await apiFetch('/mantenimiento');
        this.activo = !!r.activo;
        this.mensaje = r.mensaje || '';
        this.origen = r.origen || null;
        this.proveedor = r.proveedor || 'up';
        this.manual = !!r.manual;
      } catch { /* el sondeo es best-effort: un fallo no debe romper la bandeja */ }
    },
    iniciar(cadaMs = 45000) {
      if (this._timer) return;
      this.cargar();
      this._timer = setInterval(() => this.cargar(), cadaMs);
    },
    detener() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
  },
});
