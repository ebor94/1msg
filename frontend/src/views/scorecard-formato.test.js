import { describe, it, expect } from 'vitest';
import { colorEspera, colorTpr, minAHhMm } from '../utils/scorecard';

describe('umbrales scorecard', () => {
  it('colorEspera: verde/ámbar/rojo por minutos', () => {
    expect(colorEspera(10)).toBe('ok');
    expect(colorEspera(45)).toBe('warn');
    expect(colorEspera(90)).toBe('bad');
    expect(colorEspera(null)).toBe('none');
  });
  it('colorTpr: verde/ámbar/rojo por minutos', () => {
    expect(colorTpr(5)).toBe('ok');
    expect(colorTpr(20)).toBe('warn');
    expect(colorTpr(40)).toBe('bad');
    expect(colorTpr(null)).toBe('none');
  });
  it('minAHhMm formatea minutos a texto', () => {
    expect(minAHhMm(0)).toBe('0m');
    expect(minAHhMm(75)).toBe('1h 15m');
    expect(minAHhMm(null)).toBe('—');
  });
});
