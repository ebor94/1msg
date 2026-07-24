'use strict';

/** wa_canales — canales WABA. Hoy hay uno, pero el instanceId no se hardcodea. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Canal',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      instanceId: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      nombre: { type: DataTypes.STRING(100), allowNull: false },
      telefono: { type: DataTypes.STRING(20), allowNull: false },
      // Referencia al secreto (env / gestor), nunca el token en claro.
      tokenRef: { type: DataTypes.STRING(120), allowNull: false },
      webhookUrl: { type: DataTypes.STRING(255), allowNull: true },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'wa_canales',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
