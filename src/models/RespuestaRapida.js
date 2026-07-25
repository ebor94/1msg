'use strict';

/** wa_respuestas_rapidas — atajos de texto que cada agente guarda para responder rápido. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'RespuestaRapida',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      titulo: { type: DataTypes.STRING(80), allowNull: false },
      texto: { type: DataTypes.STRING(2000), allowNull: false },
    },
    {
      tableName: 'wa_respuestas_rapidas',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: 'actualizado_en',
    },
  );
