// frontend/src/utils/difusion.test.js
import { describe, it, expect } from 'vitest';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable } from './difusion';

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
