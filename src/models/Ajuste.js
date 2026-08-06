'use strict';
module.exports = (sequelize, DataTypes) =>
  sequelize.define('Ajuste', {
    clave: { type: DataTypes.STRING(60), primaryKey: true },
    valor: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'wa_ajustes', underscored: true,
    createdAt: false, updatedAt: 'actualizado_en',
  });
