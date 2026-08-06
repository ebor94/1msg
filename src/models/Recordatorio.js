'use strict';
module.exports = (sequelize, DataTypes) =>
  sequelize.define('Recordatorio', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    contactoId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    diaMes: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ultimoEnvioEn: { type: DataTypes.DATEONLY, allowNull: true },
    agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    creadoPorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, {
    tableName: 'wa_recordatorios', underscored: true,
    createdAt: 'creado_en', updatedAt: 'actualizado_en',
  });
