// Contador de mensajes nuevos en el título de la pestaña — respaldo visual que
// funciona sin permiso de notificaciones. Solo cuenta cuando la pestaña está en
// 2º plano; se limpia al volver a ella. La app tiene una sola pestaña, por eso
// el estado a nivel de módulo es suficiente.
let base = '';
let contador = 0;
let iniciado = false;

function pintar() {
  document.title = contador > 0 ? `(${contador}) ${base}` : base;
}

export function iniciarTituloPestana() {
  if (iniciado) return;
  iniciado = true;
  base = document.title;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { contador = 0; pintar(); }
  });
}

export function nuevoEnTitulo() {
  if (typeof document === 'undefined' || !document.hidden) return;
  contador += 1;
  pintar();
}

// Solo para test: reinicia el estado del módulo.
export function _resetTituloPestana() { base = ''; contador = 0; iniciado = false; }
