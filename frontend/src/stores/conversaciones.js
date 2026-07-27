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
    agenteFiltro: null,
    contadores: { mias: 0, general: 0, resueltos: 0, todos: 0 },
  }),
  getters: {
    hayMas: (s) => s.items.length < s.total,
  },
  actions: {
    _url(pagina) {
      let url = `/conversaciones?bandeja=${this.bandeja}&pagina=${pagina}`;
      if (this.soloNoLeidos) url += '&noLeidos=1';
      if (this.bandeja === 'todos' && this.agenteFiltro) url += `&agente=${this.agenteFiltro}`;
      return url;
    },
    async cargarContadores() {
      try {
        const c = await apiFetch('/conversaciones/contadores');
        this.contadores = { mias: c.mias || 0, general: c.general || 0, resueltos: c.resueltos || 0, todos: c.todos || 0 };
      } catch { /* no crítico: los badges no son fuente de verdad */ }
    },
    async cargar(bandeja = this.bandeja) {
      this.bandeja = bandeja;
      this.cargando = true;
      this.error = '';
      this.pagina = 0;
      this.cargandoMas = false; // una carga fresh reinicia también el estado de "cargar más"
      this.cargarContadores(); // en paralelo, no bloquea la lista
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
      if (b === this.bandeja) return;
      if (b !== 'todos') this.agenteFiltro = null;
      this.cargar(b);
    },
    alternarNoLeidos() {
      this.soloNoLeidos = !this.soloNoLeidos;
      this.cargar();
    },
    setAgenteFiltro(id) {
      this.agenteFiltro = id || null;
      this.cargar();
    },
  },
});
