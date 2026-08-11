// frontend/src/utils/difusion.test.js
import { describe, it, expect } from 'vitest';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable, columnasRequeridas } from './difusion';

describe('difusion utils', () => {
  it('renderizarCuerpo reemplaza {{n}} en orden', () => {
    expect(renderizarCuerpo('Hola {{1}}, debes {{2}}', ['Ana', '$5'])).toBe('Hola Ana, debes $5');
    expect(renderizarCuerpo('Sin vars', [])).toBe('Sin vars');
    expect(renderizarCuerpo('Falta {{2}}', ['x'])).toBe('Falta ');
  });
  it('parsearCsvPreview saca cabeceras y primera fila', () => {
    const r = parsearCsvPreview('CELULAR,NOMBRE\n3001234567,Ana\n3009999999,Beto');
    expect(r.cabeceras).toEqual(['CELULAR', 'NOMBRE']);
    expect(r.primera.NOMBRE).toBe('Ana');
    expect(parsearCsvPreview('').primera).toBe(null);
  });
  it('valorDeVariable resuelve columna y fijo', () => {
    expect(valorDeVariable({ tipo: 'columna', columna: 'NOMBRE' }, { NOMBRE: 'Ana' })).toBe('Ana');
    expect(valorDeVariable({ tipo: 'fijo', valor: '$5' }, { NOMBRE: 'Ana' })).toBe('$5');
  });
});

describe('columnasRequeridas', () => {
  const mapeo = { telefono: 'CELULAR', agente: 'AGENTE_ID', variables: [{ tipo: 'columna', columna: 'NOMBRE' }, { tipo: 'fijo', valor: '$1' }] };
  it('lista teléfono, agente y columnas de variables (sin duplicar)', () => {
    expect(columnasRequeridas(mapeo, false)).toEqual(['CELULAR', 'AGENTE_ID', 'NOMBRE']);
  });
  it('agrega CEDULA cuando requiere resumen', () => {
    expect(columnasRequeridas(mapeo, true)).toEqual(['CELULAR', 'AGENTE_ID', 'NOMBRE', 'CEDULA']);
  });
});
