'use strict';

/** wa_etiquetas — catálogo de etiquetas de conversación. */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Etiqueta',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
      categoria: { type: DataTypes.ENUM('origen', 'interes'), allowNull: false, defaultValue: 'interes' },
      color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#888780' },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      orden: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'wa_etiquetas',
      timestamps: false,
    },
  );
