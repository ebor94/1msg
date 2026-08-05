import { describe, it, expect } from 'vitest';
import { etiquetaCampo, formatoValor, esMoneda, formatoCelda } from './tablas';

describe('etiquetaCampo', () => {
  it('reemplaza guiones bajos y capitaliza', () => {
    expect(etiquetaCampo('saldo_pendiente')).toBe('Saldo pendiente');
  });
});

describe('formatoValor', () => {
  it('vacío → guion, fecha ISO → fecha local, resto string', () => {
    expect(formatoValor(null)).toBe('—');
    expect(formatoValor('')).toBe('—');
    expect(formatoValor('2025-10-28T00:00:00.000Z')).toMatch(/2025/);
    expect(formatoValor(5)).toBe('5');
  });
});

describe('esMoneda', () => {
  it('detecta columnas de dinero', () => {
    expect(esMoneda('Vr. Cuota')).toBe(true);
    expect(esMoneda('Vr. Abonado')).toBe(true);
    expect(esMoneda('Saldo Pendiente')).toBe(true);
    expect(esMoneda('valor')).toBe(true);
    expect(esMoneda('total_pagado')).toBe(true);
  });
  it('NO marca columnas que no son dinero', () => {
    expect(esMoneda('Plazo')).toBe(false);
    expect(esMoneda('# Cuotas Vencidas')).toBe(false);
    expect(esMoneda('Cuota Pendiente')).toBe(false);
    expect(esMoneda('Contrato')).toBe(false);
  });
});

describe('formatoCelda', () => {
  it('dinero → $ con separadores de miles', () => {
    expect(formatoCelda('Vr. Abonado', 1627500)).toBe('$1.627.500');
  });
  it('número no-moneda → sin $', () => {
    expect(formatoCelda('Plazo', 1)).toBe('1');
  });
  it('fecha y vacío se comportan como formatoValor', () => {
    expect(formatoCelda('Fecha Vencimiento', null)).toBe('—');
    expect(formatoCelda('Expedicion', '2025-10-28T00:00:00.000Z')).toMatch(/2025/);
  });
});
