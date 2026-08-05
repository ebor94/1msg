import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const fetchMock = vi.fn();
vi.mock('../api/cliente', () => ({
  apiFetch: (...a) => fetchMock(...a),
  tokenGuardado: () => 't',
}));

import { useAcciones } from './acciones';

describe('acciones scorecard', () => {
  beforeEach(() => { setActivePinia(createPinia()); fetchMock.mockReset(); });

  it('cargarBacklogVivo pega al endpoint vivo', async () => {
    fetchMock.mockResolvedValue({ agentes: [], general: { sinResponder: 0, esperaMasViejaMin: null } });
    const acc = useAcciones();
    const r = await acc.cargarBacklogVivo();
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes/vivo');
    expect(r.general.sinResponder).toBe(0);
  });

  it('cargarScorecard con fecha arma el query', async () => {
    fetchMock.mockResolvedValue({ fecha: '2026-08-03', agentes: [], totales: {} });
    const acc = useAcciones();
    await acc.cargarScorecard('2026-08-03');
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes?fecha=2026-08-03');
  });

  it('cargarScorecard sin fecha pega al endpoint base', async () => {
    fetchMock.mockResolvedValue({ fecha: 'hoy', agentes: [], totales: {} });
    const acc = useAcciones();
    await acc.cargarScorecard();
    expect(fetchMock).toHaveBeenCalledWith('/reportes/agentes');
  });
});
