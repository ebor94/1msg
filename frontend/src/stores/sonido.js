import { defineStore } from 'pinia';
import notificacion from '../assets/notificacion.mp3';

const CLAVE = 'wa_sonido';
let audio = null;

export const useSonido = defineStore('sonido', {
  state: () => ({ activado: localStorage.getItem(CLAVE) !== '0' }),
  actions: {
    alternar() {
      this.activado = !this.activado;
      localStorage.setItem(CLAVE, this.activado ? '1' : '0');
    },
    reproducir() {
      if (!this.activado) return;
      if (!audio) audio = new Audio(notificacion);
      audio.currentTime = 0;
      // El navegador puede bloquear autoplay hasta una interacción; se ignora el error.
      audio.play().catch(() => {});
    },
  },
});
