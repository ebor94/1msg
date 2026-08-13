import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({ apiFetch: (...a) => fetchMock(...a), tokenGuardado: () => 't' }));

import { useAcciones } from './acciones';

describe('acciones gestión IA', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('gestionarConIa hace PATCH del flag', async () => {
    fetchMock.mockResolvedValue({ contacto: { id: 3, gestionarConIa: true } });
    const acc = useAcciones();
    await acc.gestionarConIa(3, true);
    expect(fetchMock).toHaveBeenCalledWith('/contactos/3', { method: 'PATCH', body: JSON.stringify({ gestionarConIa: true }) });
  });

  it('descartarBorrador hace DELETE', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const acc = useAcciones();
    await acc.descartarBorrador(9);
    expect(fetchMock).toHaveBeenCalledWith('/conversaciones/9/borrador', { method: 'DELETE' });
  });

  it('guardarPromptIa hace PUT', async () => {
    fetchMock.mockResolvedValue({ prompt: 'nuevo' });
    const acc = useAcciones();
    const r = await acc.guardarPromptIa('nuevo');
    expect(fetchMock).toHaveBeenCalledWith('/ajustes/ia-gestion-prompt', { method: 'PUT', body: JSON.stringify({ prompt: 'nuevo' }) });
    expect(r).toBe('nuevo');
  });
});
