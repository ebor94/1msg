import { defineStore } from 'pinia';
import { apiFetch } from '../api/cliente';

export const useConversaciones = defineStore('conversaciones', {
  state: () => ({
    bandeja: 'mias',
    items: [],
    total: 0,
    pagina: 0,
    cargando: false,
    cargandoMas: false,
    error: '',
    soloNoLeidos: false,
  }),
  getters: {
    hayMas: (s) => s.items.length < s.total,
  },
  actions: {
    _url(pagina) {
      let url = `/conversaciones?bandeja=${this.bandeja}&pagina=${pagina}`;
      if (this.soloNoLeidos) url += '&noLeidos=1';
      return url;
    },
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      this.pagina = 0;
      try {
        const r = await apiFetch(this._url(0));
        this.items = r.conversaciones;
        this.total = r.total;
      } catch (e) {
        this.error = 'No se pudo cargar la bandeja.';
        this.items = [];
        this.total = 0;
      } finally {
        this.cargando = false;
      }
    },
    async cargarMas() {
      if (this.cargandoMas || !this.hayMas) return;
      this.cargandoMas = true;
      const bandeja = this.bandeja;
      try {
        const r = await apiFetch(this._url(this.pagina + 1));
        // Descartar si cambió la bandeja mientras estaba en vuelo.
        if (this.bandeja !== bandeja) return;
        this.pagina += 1;
        this.total = r.total;
        const vistos = new Set(this.items.map((c) => c.id));
        const nuevos = r.conversaciones.filter((c) => !vistos.has(c.id));
        this.items = [...this.items, ...nuevos];
      } catch {
        /* silencioso: se puede reintentar al seguir scrolleando */
      } finally {
        if (this.bandeja === bandeja) this.cargandoMas = false;
      }
    },
    cambiarBandeja(b) {
      if (b !== this.bandeja) this.cargar(b);
    },
    alternarNoLeidos() {
      this.soloNoLeidos = !this.soloNoLeidos;
      this.cargar();
    },
  },
});
