import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useNotificaciones } from './notificaciones';

function stubNotification({ permission = 'default', requestResult = 'granted' } = {}) {
  const ctor = vi.fn();
  ctor.permission = permission;
  ctor.requestPermission = vi.fn().mockResolvedValue(requestResult);
  global.Notification = ctor;
  window.Notification = ctor;
  return ctor;
}

describe('store notificaciones', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); document.hasFocus = () => false; });
  afterEach(() => { delete global.Notification; delete window.Notification; });

  it('activar() con permiso granted activa y persiste', async () => {
    stubNotification({ requestResult: 'granted' });
    const n = useNotificaciones();
    await n.activar();
    expect(n.activado).toBe(true);
    expect(localStorage.getItem('wa_notif')).toBe('1');
  });
  it('activar() con permiso denegado no activa', async () => {
    stubNotification({ requestResult: 'denied' });
    const n = useNotificaciones();
    await n.activar();
    expect(n.activado).toBe(false);
  });
  it('bloqueado cuando permission=denied; activar() no pide permiso', async () => {
    const ctor = stubNotification({ permission: 'denied' });
    const n = useNotificaciones();
    expect(n.bloqueado).toBe(true);
    await n.activar();
    expect(ctor.requestPermission).not.toHaveBeenCalled();
  });
  it('mostrar() no crea notificación si no está activado', () => {
    const ctor = stubNotification({ permission: 'granted' });
    useNotificaciones().mostrar({ conversacionId: 1, titulo: 'x', cuerpo: 'y' });
    expect(ctor).not.toHaveBeenCalled();
  });
  it('mostrar() no crea notificación si la bandeja está enfocada', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => true;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 1, titulo: 'x', cuerpo: 'y' });
    expect(ctor).not.toHaveBeenCalled();
  });
  it('mostrar() crea la notificación con tag por conversación cuando corresponde', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => false;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 7, titulo: 'Luis', cuerpo: 'hola' });
    expect(ctor).toHaveBeenCalledWith('Luis', { body: 'hola', tag: 'wa-conv-7' });
  });
  it('mostrar({omitirFoco:true}) crea la notificación aunque la bandeja esté enfocada', () => {
    const ctor = stubNotification({ permission: 'granted' });
    document.hasFocus = () => true;
    const n = useNotificaciones();
    n.activado = true;
    n.mostrar({ conversacionId: 3, titulo: 'Contacto asignado', cuerpo: 'Se te asignó el chat de Ana', omitirFoco: true });
    expect(ctor).toHaveBeenCalledWith('Contacto asignado', { body: 'Se te asignó el chat de Ana', tag: 'wa-conv-3' });
  });
});
