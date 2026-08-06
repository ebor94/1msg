'use strict';

const { DIRECCION, TIPO_MENSAJE, ESTADO_MENSAJE } = require('../config/constants');

/**
 * wa_mensajes. wa_message_id UNIQUE es la idempotencia frente a los reintentos
 * del webhook (upsert por esa clave). ts_proveedor manda sobre creado_en para
 * el orden real. media_ruta es TU copia; la URL de 1msg expira en ~5 minutos.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Mensaje',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      conversacionId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      waMessageId: { type: DataTypes.STRING(128), allowNull: true, unique: true },
      direccion: { type: DataTypes.ENUM(...Object.values(DIRECCION)), allowNull: false },
      tipo: {
        type: DataTypes.ENUM(...Object.values(TIPO_MENSAJE)),
        allowNull: false,
        defaultValue: TIPO_MENSAJE.TEXT,
      },
      texto: { type: DataTypes.TEXT, allowNull: true },
      mediaId: { type: DataTypes.STRING(128), allowNull: true },
      mediaRuta: { type: DataTypes.STRING(255), allowNull: true },
      mediaMime: { type: DataTypes.STRING(100), allowNull: true },
      mediaNombre: { type: DataTypes.STRING(180), allowNull: true },
      mediaUrl: { type: DataTypes.TEXT, allowNull: true },
      mediaBytes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      historico: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // traído por backfill
      respondeAId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      plantillaNombre: { type: DataTypes.STRING(120), allowNull: true },
      enviadoPorId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // NULL si lo envió el bot
      enviadoPorBot: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      estado: {
        type: DataTypes.ENUM(...Object.values(ESTADO_MENSAJE)),
        allowNull: false,
        defaultValue: ESTADO_MENSAJE.PENDIENTE,
      },
      errorCodigo: { type: DataTypes.STRING(20), allowNull: true }, // 131049, 130472, 131047...
      errorDetalle: { type: DataTypes.STRING(255), allowNull: true },
      intentos: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      tsProveedor: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'wa_mensajes',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: 'actualizado_en',
    },
  );
