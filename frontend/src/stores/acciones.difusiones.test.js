// frontend/src/stores/acciones.difusiones.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({
  apiFetch: (...a) => fetchMock(...a),
  tokenGuardado: () => 't',
}));

import { useAcciones } from './acciones';

describe('acciones difusiones', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('listarDifusiones pega al endpoint', async () => {
    fetchMock.mockResolvedValue({ difusiones: [{ id: 1 }] });
    const acc = useAcciones();
    const r = await acc.listarDifusiones();
    expect(fetchMock).toHaveBeenCalledWith('/difusiones');
    expect(r).toEqual([{ id: 1 }]);
  });
  it('crearDifusion hace POST con el cuerpo', async () => {
    fetchMock.mockResolvedValue({ difusion: { id: 5 } });
    const acc = useAcciones();
    const r = await acc.crearDifusion({ nombre: 'X', plantilla: 'p' });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones', { method: 'POST', body: JSON.stringify({ nombre: 'X', plantilla: 'p' }) });
    expect(r.id).toBe(5);
  });
  it('cargarDestinatariosDifusion hace POST del texto+mapeo', async () => {
    fetchMock.mockResolvedValue({ total: 1, pendientes: 1, omitidos: [] });
    const acc = useAcciones();
    await acc.cargarDestinatariosDifusion(5, { texto: 'a', mapeo: { telefono: 'CELULAR' } });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/destinatarios', { method: 'POST', body: JSON.stringify({ texto: 'a', mapeo: { telefono: 'CELULAR' } }) });
  });
  it('iniciarDifusion y cancelarDifusion pegan a sus rutas', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const acc = useAcciones();
    await acc.iniciarDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/iniciar', { method: 'POST' });
    await acc.cancelarDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/cancelar', { method: 'POST' });
  });
  it('detalleDifusion y destinatariosDifusion', async () => {
    fetchMock.mockResolvedValue({ embudo: {}, filas: [] });
    const acc = useAcciones();
    await acc.detalleDifusion(5);
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5');
    await acc.destinatariosDifusion(5, { estado: 'fallido', pagina: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/difusiones/5/destinatarios?estado=fallido&pagina=2');
  });
});
