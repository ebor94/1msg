'use strict';

/**
 * Mapea un contacto + su conversación actual (o null) a un resultado de búsqueda,
 * con banderas de propiedad y una `conversacion` lista para abrir en el frontend.
 * Puro (recibe objetos planos); no toca la BD.
 */
function construirResultado(contacto, conv, miAgenteId) {
  const nombre = contacto.nombreDisplay || contacto.nombreWa || contacto.telefono;
  // Dueño efectivo: el agente de la conversación si existe; si el contacto aún no
  // tiene chat, caemos al dueño histórico (agente_dueno_id) para que el buscador
  // refleje la asignación (importados, salientes) y no lo pinte como "de otro".
  const agenteActualId = conv ? conv.agenteId : (contacto.agenteDuenoId ?? null);
  const agenteActualNombre = conv
    ? (conv.agente ? conv.agente.nombre : null)
    : (contacto.agenteDueno ? contacto.agenteDueno.nombre : null);
  return {
    contactoId: contacto.id,
    telefono: contacto.telefono,
    nombre,
    tieneConversacion: !!conv,
    conversacionId: conv ? conv.id : null,
    agenteActualId,
    agenteActualNombre,
    esMio: miAgenteId != null && agenteActualId === miAgenteId,
    esGeneral: conv ? conv.agenteId === null : false,
    conversacion: conv
      ? {
          id: conv.id,
          agenteId: conv.agenteId,
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
