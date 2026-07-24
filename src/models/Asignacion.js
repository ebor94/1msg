'use strict';

const { TIPO_ASIGNACION } = require('../config/constants');

/**
 * wa_asignaciones — auditoría de a quién pertenece cada conversación y por qué.
 * Con 15 agentes y contactos que rotan, esta tabla zanja las discusiones.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Asignacion',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      conversacionId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      deAgenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      aAgenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tipo: { type: DataTypes.ENUM(...Object.values(TIPO_ASIGNACION)), allowNull: false },
      ejecutadoPorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // NULL si lo hizo el sistema
      motivo: { type: DataTypes.STRING(200), allowNull: true },
    },
    {
      tableName: 'wa_asignaciones',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
