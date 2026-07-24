'use strict';

/**
 * Errores de dominio. Nunca se traga una excepción en silencio;
 * los errores de 1msg siempre cargan su código.
 */

class AppError extends Error {
  constructor(mensaje, { status = 500, codigo = null, causa = null } = {}) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
    if (causa) this.causa = causa;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Error devuelto por la API de 1msg; conserva el código de Meta/1msg. */
class OneMsgError extends AppError {
  constructor(mensaje, { codigo = null, status = 502, causa = null } = {}) {
    super(mensaje, { status, codigo, causa });
  }
}

/** Conflicto de toma de chat: otro agente se adelantó (affectedRows = 0). */
class ConflictoError extends AppError {
  constructor(mensaje = 'Recurso tomado por otro agente') {
    super(mensaje, { status: 409 });
  }
}

module.exports = { AppError, OneMsgError, ConflictoError };
