// Calcula la selección siguiente al pulsar una etiqueta. Regla: 1 origen, varios intereses.
export function siguienteSeleccion(actuales, etiqueta) {
  if (actuales.some((e) => e.id === etiqueta.id)) {
    return actuales.filter((e) => e.id !== etiqueta.id); // toggle off
  }
  if (etiqueta.categoria === 'origen') {
    return [...actuales.filter((e) => e.categoria !== 'origen'), etiqueta];
  }
  return [...actuales, etiqueta];
}
