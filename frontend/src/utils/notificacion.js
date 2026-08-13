// Vista previa de un mensaje entrante para la notificación de escritorio: el
// texto recortado, o una etiqueta según el tipo de media si no trae texto.
const RECORTE = 120;

const ETIQUETAS_MEDIA = {
  image: '📷 Imagen',
  audio: '🎤 Audio',
  video: '🎬 Video',
  document: '📎 Documento',
  sticker: 'Sticker',
  location: '📍 Ubicación',
};

export function vistaPreviaMensaje(mensaje) {
  const texto = mensaje && mensaje.texto ? String(mensaje.texto).trim() : '';
  if (texto) return texto.length > RECORTE ? `${texto.slice(0, RECORTE - 1)}…` : texto;
  return ETIQUETAS_MEDIA[mensaje && mensaje.tipo] || 'Nuevo mensaje';
}
