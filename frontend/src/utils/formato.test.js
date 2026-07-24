import { describe, it, expect } from 'vitest';
import { iniciales, iconoEstado, esLeido, etiquetaTipo } from './formato';

describe('formato', () => {
  it('iniciales toma hasta 2 palabras', () => {
    expect(iniciales('Carlos Rincón')).toBe('CR');
    expect(iniciales('María')).toBe('M');
    expect(iniciales('')).toBe('?');
  });

  it('iconoEstado mapea estados de entrega', () => {
    expect(iconoEstado('enviado')).toBe('✓');
    expect(iconoEstado('entregado')).toBe('✓✓');
    expect(iconoEstado('leido')).toBe('✓✓');
    expect(iconoEstado('fallido')).toBe('⚠');
    expect(iconoEstado('otro')).toBe('');
  });

  it('esLeido solo true para leido', () => {
    expect(esLeido('leido')).toBe(true);
    expect(esLeido('entregado')).toBe(false);
  });

  it('etiquetaTipo para media, null para texto', () => {
    expect(etiquetaTipo('image')).toBe('[imagen]');
    expect(etiquetaTipo('text')).toBe(null);
  });
});
