import { describe, it, expect, beforeEach } from 'vitest';
import { iniciarTituloPestana, nuevoEnTitulo, _resetTituloPestana } from './tituloPestana';

function setHidden(v) { Object.defineProperty(document, 'hidden', { value: v, configurable: true }); }

describe('tituloPestana', () => {
  beforeEach(() => { _resetTituloPestana(); document.title = 'Bandeja'; });

  it('suma al título cuando la pestaña está en 2º plano', () => {
    setHidden(true);
    iniciarTituloPestana();
    nuevoEnTitulo();
    nuevoEnTitulo();
    expect(document.title).toBe('(2) Bandeja');
  });
  it('no suma cuando la pestaña está visible', () => {
    setHidden(false);
    iniciarTituloPestana();
    nuevoEnTitulo();
    expect(document.title).toBe('Bandeja');
  });
  it('limpia el contador al volver a la pestaña', () => {
    setHidden(true);
    iniciarTituloPestana();
    nuevoEnTitulo();
    expect(document.title).toBe('(1) Bandeja');
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe('Bandeja');
  });
});
