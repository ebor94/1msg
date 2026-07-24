'use strict';

/** wa_notas_internas — no salen a WhatsApp, solo las ve el equipo. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'NotaInterna',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      conversacionId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      nota: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      tableName: 'wa_notas_internas',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
