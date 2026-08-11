'use strict';

/**
 * wa_difusion_destinatarios — cada destinatario guarda su propio desenlace,
 * lo que cierra el círculo con los errores 131049 / 130472.
 * Esta tabla solo tiene actualizado_en (sin creado_en).
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'DifusionDestinatario',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      difusionId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      contactoId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      parametros: { type: DataTypes.JSON, allowNull: true },
      documento: { type: DataTypes.STRING(20), allowNull: true },
      waMessageId: { type: DataTypes.STRING(128), allowNull: true },
      estado: {
        type: DataTypes.ENUM('pendiente', 'enviado', 'entregado', 'leido', 'fallido', 'omitido'),
        allowNull: false,
        defaultValue: 'pendiente',
      },
      errorCodigo: { type: DataTypes.STRING(20), allowNull: true },
      intentos: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      reintentarEn: { type: DataTypes.DATE, allowNull: true },
      resumenEn: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'wa_difusion_destinatarios',
      timestamps: true,
      createdAt: false,
      updatedAt: 'actualizado_en',
    },
  );
