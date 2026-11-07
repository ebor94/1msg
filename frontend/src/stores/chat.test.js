import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';
import { useAuth } from './auth';

describe('store chat', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.setItem('wa_token', 't'); });

  it('abrir un chat gestionable carga mensajes, marca leído y pone el badge en 0', async () => {
    useAuth().agente = { id: 1, rol: 'asesor' };
    const conv = useConversaciones();
    conv.items = [{ id: 5, noLeidos: 3, agenteId: 1, contacto: { nombreWa: 'Ana' } }];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mensajes: [{ id: 1, direccion: 'in', texto: 'hola' }] }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, etiquetas: [] }) });

    const chat = useChat();
    await chat.abrir(conv.items[0]);

    expect(chat.mensajes.length).toBe(1);
    expect(chat.conversacion.id).toBe(5);
    expect(conv.items[0].noLeidos).toBe(0);
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/conversaciones/5/mensajes', expect.anything());
    expect(global.fetch).toHaveBeenCalledWith('/api/conversaciones/5/leer', expect.objectContaining({ method: 'POST' }));
  });

  it('abrir en solo lectura (chat de otro agente) carga mensajes pero NO marca leído', async () => {
    useAuth().agente = { id: 1, rol: 'asesor' };
    const conv = useConversaciones();
    conv.items = [{ id: 8, noLeidos: 2, agenteId: 99, contacto: { nombreWa: 'Otro' } }];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mensajes: [{ id: 1, direccion: 'in', texto: 'hola' }] }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ etiquetas: [] }) });

    const chat = useChat();
    await chat.abrir(conv.items[0]);

    expect(chat.mensajes.length).toBe(1);
    expect(chat.gestionable).toBe(false);
    expect(conv.items[0].noLeidos).toBe(2); // no se tocó el no-leído del dueño
    expect(global.fetch).not.toHaveBeenCalledWith('/api/conversaciones/8/leer', expect.anything());
  });

  it('enviar hace POST y agrega el mensaje', async () => {
    const chat = useChat();
    chat.conversacion = { id: 7, contacto: {} };
    chat.mensajes = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => ({ mensaje: { id: 99, direccion: 'out', texto: 'hola' } }),
    });
    await chat.enviar('hola');
    expect(chat.mensajes.at(-1).id).toBe(99);
    expect(global.fetch).toHaveBeenCalledWith('/api/conversaciones/7/mensajes', expect.objectContaining({ method: 'POST' }));
  });
});
