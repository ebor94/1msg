import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({ apiFetch: (...a) => fetchMock(...a), tokenGuardado: () => 't' }));
import { useAcciones } from './acciones';

describe('acciones recordatorio', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });
  it('cargarRecordatorio hace GET y devuelve el recordatorio', async () => {
    fetchMock.mockResolvedValue({ recordatorio: { activo: true, diaMes: 5 } });
    const acc = useAcciones();
    const r = await acc.cargarRecordatorio(9);
    expect(fetchMock).toHaveBeenCalledWith('/contactos/9/recordatorio');
    expect(r.diaMes).toBe(5);
  });
  it('guardarRecordatorio hace PUT con el cuerpo', async () => {
    fetchMock.mockResolvedValue({ recordatorio: { activo: true, diaMes: 8 } });
    const acc = useAcciones();
    await acc.guardarRecordatorio(9, { activo: true, diaMes: 8 });
    expect(fetchMock).toHaveBeenCalledWith('/contactos/9/recordatorio', { method: 'PUT', body: JSON.stringify({ activo: true, diaMes: 8 }) });
  });
});
