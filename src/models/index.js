'use strict';

/**
 * Registro de modelos y asociaciones.
 *
 * Todos los modelos se mapean contra el esquema YA existente en serfuweb.
 * Aquí NO se llama a sequelize.sync() de ninguna forma: el esquema es la
 * fuente de verdad, el código se ajusta a él.
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Definición de cada modelo (uno por tabla wa_).
const Canal = require('./Canal')(sequelize, DataTypes);
const Agente = require('./Agente')(sequelize, DataTypes);
const Contacto = require('./Contacto')(sequelize, DataTypes);
const Conversacion = require('./Conversacion')(sequelize, DataTypes);
const Mensaje = require('./Mensaje')(sequelize, DataTypes);
const Asignacion = require('./Asignacion')(sequelize, DataTypes);
const NotaInterna = require('./NotaInterna')(sequelize, DataTypes);
const Etiqueta = require('./Etiqueta')(sequelize, DataTypes);
const ConversacionEtiqueta = require('./ConversacionEtiqueta')(sequelize, DataTypes);
const EventoWebhook = require('./EventoWebhook')(sequelize, DataTypes);
const Difusion = require('./Difusion')(sequelize, DataTypes);
const DifusionDestinatario = require('./DifusionDestinatario')(sequelize, DataTypes);

// -------------------------------------------------------------------
// Asociaciones. foreignKey apunta al atributo ya declarado en el modelo,
// para no inventar columnas nuevas sobre el esquema existente.
// -------------------------------------------------------------------

// Canal 1—N Conversacion
Canal.hasMany(Conversacion, { foreignKey: 'canalId', as: 'conversaciones' });
Conversacion.belongsTo(Canal, { foreignKey: 'canalId', as: 'canal' });

// Canal 1—N Difusion
Canal.hasMany(Difusion, { foreignKey: 'canalId', as: 'difusiones' });
Difusion.belongsTo(Canal, { foreignKey: 'canalId', as: 'canal' });

// Contacto 1—N Conversacion
Contacto.hasMany(Conversacion, { foreignKey: 'contactoId', as: 'conversaciones' });
Conversacion.belongsTo(Contacto, { foreignKey: 'contactoId', as: 'contacto' });

// Agente 1—N Conversacion (opcional: agente_id puede ser NULL = general)
Agente.hasMany(Conversacion, { foreignKey: 'agenteId', as: 'conversaciones' });
Conversacion.belongsTo(Agente, { foreignKey: 'agenteId', as: 'agente' });

// Agente 1—N Contacto (como dueño histórico)
Agente.hasMany(Contacto, { foreignKey: 'agenteDuenoId', as: 'contactosPropios' });
Contacto.belongsTo(Agente, { foreignKey: 'agenteDuenoId', as: 'agenteDueno' });

// Conversacion 1—N Mensaje
Conversacion.hasMany(Mensaje, { foreignKey: 'conversacionId', as: 'mensajes' });
Mensaje.belongsTo(Conversacion, { foreignKey: 'conversacionId', as: 'conversacion' });

// Conversacion 1—N Asignacion
Conversacion.hasMany(Asignacion, { foreignKey: 'conversacionId', as: 'asignaciones' });
Asignacion.belongsTo(Conversacion, { foreignKey: 'conversacionId', as: 'conversacion' });

// Conversacion 1—N NotaInterna
Conversacion.hasMany(NotaInterna, { foreignKey: 'conversacionId', as: 'notas' });
NotaInterna.belongsTo(Conversacion, { foreignKey: 'conversacionId', as: 'conversacion' });
NotaInterna.belongsTo(Agente, { foreignKey: 'agenteId', as: 'agente' });

// Mensaje → Agente que lo envió (NULL si lo envió el bot)
Mensaje.belongsTo(Agente, { foreignKey: 'enviadoPorId', as: 'enviadoPor' });
// Mensaje → mensaje al que responde (auto-referencia)
Mensaje.belongsTo(Mensaje, { foreignKey: 'respondeAId', as: 'respondeA' });

// Asignacion → agentes involucrados
Asignacion.belongsTo(Agente, { foreignKey: 'deAgenteId', as: 'deAgente' });
Asignacion.belongsTo(Agente, { foreignKey: 'aAgenteId', as: 'aAgente' });
Asignacion.belongsTo(Agente, { foreignKey: 'ejecutadoPorId', as: 'ejecutadoPor' });

// Conversacion N—M Etiqueta a través de wa_conversacion_etiqueta
Conversacion.belongsToMany(Etiqueta, {
  through: ConversacionEtiqueta,
  foreignKey: 'conversacionId',
  otherKey: 'etiquetaId',
  as: 'etiquetas',
});
Etiqueta.belongsToMany(Conversacion, {
  through: ConversacionEtiqueta,
  foreignKey: 'etiquetaId',
  otherKey: 'conversacionId',
  as: 'conversaciones',
});

// Difusion 1—N DifusionDestinatario
Difusion.hasMany(DifusionDestinatario, { foreignKey: 'difusionId', as: 'destinatarios' });
DifusionDestinatario.belongsTo(Difusion, { foreignKey: 'difusionId', as: 'difusion' });

// Contacto 1—N DifusionDestinatario
Contacto.hasMany(DifusionDestinatario, { foreignKey: 'contactoId', as: 'difusiones' });
DifusionDestinatario.belongsTo(Contacto, { foreignKey: 'contactoId', as: 'contacto' });

const db = {
  sequelize,
  Canal,
  Agente,
  Contacto,
  Conversacion,
  Mensaje,
  Asignacion,
  NotaInterna,
  Etiqueta,
  ConversacionEtiqueta,
  EventoWebhook,
  Difusion,
  DifusionDestinatario,
};

module.exports = db;
