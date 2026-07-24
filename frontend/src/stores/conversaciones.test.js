import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConversaciones } from './conversaciones';

describe('store conversaciones', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.setItem('wa_token', 't'); });

  it('cargar llena items desde la API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ total: 1, pagina: 0, conversaciones: [{ id: 5, contacto: { nombreWa: 'Ana' } }] }),
    });
    const s = useConversaciones();
    await s.cargar('mias');
    expect(s.items.length).toBe(1);
    expect(s.items[0].id).toBe(5);
    expect(global.fetch).toHaveBeenCalledWith('/api/conversaciones?bandeja=mias', expect.anything());
  });
});
