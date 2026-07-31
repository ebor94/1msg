import { describe, it, expect } from 'vitest';
import { siguienteSeleccion } from './etiquetas';

const web = { id: 1, categoria: 'origen' };
const mostrador = { id: 2, categoria: 'origen' };
const prenec = { id: 8, categoria: 'interes' };
const abono = { id: 9, categoria: 'interes' };

describe('siguienteSeleccion', () => {
  it('agrega un interés a la selección', () => {
    expect(siguienteSeleccion([web], prenec).map((e) => e.id).sort()).toEqual([1, 8]);
  });
  it('un segundo origen reemplaza al primero (1 origen)', () => {
    const r = siguienteSeleccion([web, prenec], mostrador);
    expect(r.map((e) => e.id).sort()).toEqual([2, 8]);
  });
  it('pulsar una etiqueta ya puesta la quita', () => {
    expect(siguienteSeleccion([web, prenec], prenec).map((e) => e.id)).toEqual([1]);
  });
  it('pulsar el origen seleccionado lo deselecciona', () => {
    expect(siguienteSeleccion([web, abono], web).map((e) => e.id)).toEqual([9]);
  });
});
