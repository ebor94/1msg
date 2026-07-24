'use strict';

/** wa_conversacion_etiqueta — tabla puente conversación ⇄ etiqueta (PK compuesta). */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'ConversacionEtiqueta',
    {
      conversacionId: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      etiquetaId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // quién la puso
    },
    {
      tableName: 'wa_conversacion_etiqueta',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
