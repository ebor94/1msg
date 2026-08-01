import { describe, it, expect } from 'vitest';
import { PAISES, componerTelefono } from './paises';

describe('paises', () => {
  it('Colombia es el país por defecto (+57)', () => {
    expect(PAISES[0].codigo).toBe('57');
    expect(PAISES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('componerTelefono', () => {
  it('antepone el indicativo a un número local', () => {
    expect(componerTelefono('57', '3001234567')).toBe('573001234567');
  });
  it('no duplica el indicativo si el número ya lo trae', () => {
    expect(componerTelefono('57', '573001234567')).toBe('573001234567');
  });
  it('quita espacios, guiones, paréntesis y +', () => {
    expect(componerTelefono('57', '+57 300 123-4567')).toBe('573001234567');
    expect(componerTelefono('57', '(300) 123 4567')).toBe('573001234567');
  });
  it('funciona con otros indicativos', () => {
    expect(componerTelefono('1', '5551234567')).toBe('15551234567');
  });
  it('devuelve cadena vacía si no hay dígitos', () => {
    expect(componerTelefono('57', '')).toBe('');
    expect(componerTelefono('57', 'abc')).toBe('');
  });
});
