// frontend/src/utils/difusion.test.js
import { describe, it, expect } from 'vitest';
import { renderizarCuerpo, parsearCsvPreview, valorDeVariable, columnasRequeridas, initCarrusel, carruselBackend } from './difusion';

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

describe('carrusel', () => {
  const def = { carrusel: { bodyVars: 1, cards: [{ variables: 4 }, { variables: 2 }] } };

  it('initCarrusel dimensiona bodyVars y las vars de cada tarjeta', () => {
    const est = initCarrusel(def);
    expect(est.bodyVars).toEqual(['']);
    expect(est.cards.length).toBe(2);
    expect(est.cards[0].vars).toEqual(['', '', '', '']);
    expect(est.cards[1].vars).toEqual(['', '']);
    expect(est.cards[0].imagenFile).toBe(null);
  });

  it('initCarrusel devuelve null si la plantilla no es carrusel', () => {
    expect(initCarrusel({ carrusel: null })).toBe(null);
  });

  it('carruselBackend deja solo bodyVars y vars (sin imágenes)', () => {
    const est = { bodyVars: ['x'], cards: [{ vars: ['a', 'b'], imagenFile: {}, imagenUrl: 'u' }] };
    expect(carruselBackend(est)).toEqual({ bodyVars: ['x'], cards: [{ vars: ['a', 'b'] }] });
  });
});
