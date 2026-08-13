import { describe, it, expect } from 'vitest';
import { vistaPreviaMensaje } from './notificacion';

describe('vistaPreviaMensaje', () => {
  it('devuelve el texto, recortado a 120 con elipsis', () => {
    expect(vistaPreviaMensaje({ tipo: 'text', texto: 'hola' })).toBe('hola');
    const r = vistaPreviaMensaje({ tipo: 'text', texto: 'a'.repeat(200) });
    expect(r.length).toBe(120);
    expect(r.endsWith('…')).toBe(true);
  });
  it('etiqueta media cuando no hay texto', () => {
    expect(vistaPreviaMensaje({ tipo: 'image', texto: '' })).toBe('📷 Imagen');
    expect(vistaPreviaMensaje({ tipo: 'audio' })).toBe('🎤 Audio');
    expect(vistaPreviaMensaje({ tipo: 'video' })).toBe('🎬 Video');
    expect(vistaPreviaMensaje({ tipo: 'document' })).toBe('📎 Documento');
  });
  it('tipo desconocido sin texto → genérico', () => {
    expect(vistaPreviaMensaje({ tipo: 'raro' })).toBe('Nuevo mensaje');
  });
  it('el texto gana sobre el tipo (imagen con caption)', () => {
    expect(vistaPreviaMensaje({ tipo: 'image', texto: 'mira esto' })).toBe('mira esto');
  });
});
