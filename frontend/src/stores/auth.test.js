import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuth } from './auth';

describe('store auth', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it('login exitoso guarda token y agente', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ token: 'tkn', agente: { id: 1, rol: 'administrador' } }),
    });
    const auth = useAuth();
    await auth.login('bortega', 'clave');
    expect(auth.token).toBe('tkn');
    expect(auth.agente.rol).toBe('administrador');
    expect(auth.estaAutenticado).toBe(true);
    expect(localStorage.getItem('wa_token')).toBe('tkn');
  });

  it('login con credenciales malas lanza y no autentica', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: 'credenciales inválidas' }),
    });
    const auth = useAuth();
    await expect(auth.login('x', 'y')).rejects.toThrow();
    expect(auth.estaAutenticado).toBe(false);
  });

  it('logout limpia estado y storage', () => {
    const auth = useAuth();
    auth.token = 'tkn'; auth.agente = { id: 1 };
    localStorage.setItem('wa_token', 'tkn');
    auth.logout();
    expect(auth.token).toBe(null);
    expect(localStorage.getItem('wa_token')).toBe(null);
  });
});
