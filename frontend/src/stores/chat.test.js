import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChat } from './chat';
import { useConversaciones } from './conversaciones';

describe('store chat', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.setItem('wa_token', 't'); });

  it('abrir carga mensajes, marca leído y pone el badge en 0', async () => {
    const conv = useConversaciones();
    conv.items = [{ id: 5, noLeidos: 3, contacto: { nombreWa: 'Ana' } }];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ mensajes: [{ id: 1, direccion: 'in', texto: 'hola' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const chat = useChat();
    await chat.abrir(conv.items[0]);

    expect(chat.mensajes.length).toBe(1);
    expect(chat.conversacion.id).toBe(5);
    expect(conv.items[0].noLeidos).toBe(0);
    expect(global.fetch).toHaveBeenNthCalledWith(1, '/api/conversaciones/5/mensajes', expect.anything());
    expect(global.fetch).toHaveBeenNthCalledWith(2, '/api/conversaciones/5/leer', expect.objectContaining({ method: 'POST' }));
  });
});
