'use strict';

/**
 * Mapea un contacto + su conversación actual (o null) a un resultado de búsqueda,
 * con banderas de propiedad y una `conversacion` lista para abrir en el frontend.
 * Puro (recibe objetos planos); no toca la BD.
 */
function construirResultado(contacto, conv, miAgenteId) {
  const nombre = contacto.nombreDisplay || contacto.nombreWa || contacto.telefono;
  const agenteId = conv ? conv.agenteId : null;
  return {
    contactoId: contacto.id,
    telefono: contacto.telefono,
    nombre,
    conversacionId: conv ? conv.id : null,
    agenteActualId: agenteId,
    agenteActualNombre: conv && conv.agente ? conv.agente.nombre : null,
    esMio: conv ? agenteId === miAgenteId : false,
    esGeneral: conv ? agenteId === null : false,
    conversacion: conv
      ? {
          id: conv.id,
          agenteId,
          ventanaExpiraEn: conv.ventanaExpiraEn,
          contacto: {
            id: contacto.id,
            waId: contacto.waId,
            telefono: contacto.telefono,
            nombreWa: contacto.nombreWa,
            nombreDisplay: contacto.nombreDisplay,
          },
        }
      : null,
  };
}

module.exports = { construirResultado };
