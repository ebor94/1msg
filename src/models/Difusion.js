'use strict';

/**
 * wa_difusiones — campañas de plantilla. Fuera del alcance de fase 1 (el envío
 * llega en fases posteriores), pero el modelo existe para mapear la tabla.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Difusion',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      canalId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      nombre: { type: DataTypes.STRING(150), allowNull: false },
      plantillaNombre: { type: DataTypes.STRING(120), allowNull: false },
      plantillaIdioma: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'es' },
      imagenUrl: { type: DataTypes.STRING(255), allowNull: true },
      categoria: {
        type: DataTypes.ENUM('marketing', 'utility', 'authentication'),
        allowNull: false,
        defaultValue: 'utility',
      },
      estado: {
        type: DataTypes.ENUM('borrador', 'programada', 'enviando', 'finalizada', 'cancelada'),
        allowNull: false,
        defaultValue: 'borrador',
      },
      programadaPara: { type: DataTypes.DATE, allowNull: true },
      creadoPorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    {
      tableName: 'wa_difusiones',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
