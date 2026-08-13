import { io } from 'socket.io-client';
import { tokenGuardado } from '../api/cliente';
import { useConversaciones } from '../stores/conversaciones';
import { useChat } from '../stores/chat';
import { useAuth } from '../stores/auth';
import { useSonido } from '../stores/sonido';
import { useNotificaciones } from '../stores/notificaciones';
import { vistaPreviaMensaje } from '../utils/notificacion';
import { nuevoEnTitulo } from '../utils/tituloPestana';

let socket = null;

function subirEnLista(convId, parche) {
  const conv = useConversaciones();
  const i = conv.items.findIndex((c) => c.id === convId);
  if (i === -1) return null;
  const item = conv.items[i];
  Object.assign(item, parche);
  conv.items.splice(i, 1);
  conv.items.unshift(item);
  return item;
}

export function conectarSocket() {
  if (socket) return;
  socket = io({ path: '/socket.io', auth: { token: tokenGuardado() } });

  socket.on('mensaje:nuevo', ({ conversacionId, mensaje }) => {
    const chat = useChat();
    const abierta = chat.conversacion && chat.conversacion.id === conversacionId;
    if (abierta && !chat.mensajes.some((m) => m.id === mensaje.id)) {
      chat.mensajes.push(mensaje);
    }
    const item = subirEnLista(conversacionId, {
      ultimoMensajeTexto: mensaje.texto, ultimoMensajeEn: mensaje.tsProveedor, ultimoMensajeDir: mensaje.direccion,
    });
    if (item && !abierta && mensaje.direccion === 'in') item.noLeidos = (item.noLeidos || 0) + 1;
    // Entrante de una conversación que NO está en la lista actual (p. ej. un chat
    // resuelto que el cliente reabre, o uno nuevo): recargar para que aparezca.
    if (!item && mensaje.direccion === 'in') useConversaciones().cargar();
    if (mensaje.direccion === 'in') useConversaciones().refrescarContadores(); // no leídos ↑
    if (!abierta && mensaje.direccion === 'in') {
      useSonido().reproducir();
      const titulo = item?.contacto?.nombreDisplay || item?.contacto?.nombreWa || item?.contacto?.telefono || 'Nuevo mensaje';
      useNotificaciones().mostrar({
        conversacionId,
        titulo,
        cuerpo: vistaPreviaMensaje(mensaje),
        onAbrir: () => {
          const conv = useConversaciones().items.find((c) => c.id === conversacionId);
          if (conv) useChat().abrir(conv);
        },
      });
      nuevoEnTitulo();
    }
  });

  socket.on('conversacion:borrador', ({ conversacionId, borrador }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.borradorIa = borrador;
  });

  socket.on('mensaje:ack', ({ waMessageId, estado }) => {
    const chat = useChat();
    const m = chat.mensajes.find((x) => x.waMessageId === waMessageId);
    if (m) m.estado = estado;
  });

  socket.on('conversacion:asignada', ({ conversacionId, agenteId }) => {
    const chat = useChat();
    if (chat.conversacion && chat.conversacion.id === conversacionId) chat.conversacion.agenteId = agenteId;
    useConversaciones().cargar();
  });

  socket.on('connect', () => {
    const conv = useConversaciones();
    if (conv.items.length || conv.bandeja) conv.cargar(conv.bandeja);
    const chat = useChat();
    if (chat.conversacion) chat.abrir(chat.conversacion);
  });

  // socket.io v4 NO reconecta ante un fallo de autenticación (JWT expirado).
  // Si el token venció, cerramos sesión y mandamos a login para no dejar la
  // bandeja "muerta" en silencio.
  socket.on('connect_error', (err) => {
    if (/auten|token|inv[aá]lid/i.test(err.message || '')) {
      desconectarSocket();
      useAuth().logout();
      window.location.href = '/login';
    }
  });
}

export function desconectarSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
