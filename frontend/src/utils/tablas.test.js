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
    expect(formatoValor(5)).toBe('5');
  });
  it('muestra la fecha del string SIN corrimiento de zona (medianoche UTC = mismo día)', () => {
    // El mssql devuelve la fecha como medianoche UTC; NO debe restarse un día.
    expect(formatoValor('2025-11-30T00:00:00.000Z')).toBe('30/11/2025');
    expect(formatoValor('2026-08-05T00:00:00.000Z')).toBe('05/08/2026');
    expect(formatoValor('2025-11-30 00:00:00.000')).toBe('30/11/2025'); // por si llega como string SQL
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
    expect(formatoCelda('Expedicion', '2025-11-30T00:00:00.000Z')).toBe('30/11/2025');
  });
});
