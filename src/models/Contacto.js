'use strict';

/**
 * wa_contactos. agente_dueno_id es la continuidad: si el número vuelve a
 * escribir, la conversación cae con su agente histórico.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Contacto',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      waId: { type: DataTypes.STRING(40), allowNull: false, unique: true }, // 57300xxxxxxx@c.us
      telefono: { type: DataTypes.STRING(20), allowNull: false },
      nombreWa: { type: DataTypes.STRING(120), allowNull: true },
      nombreDisplay: { type: DataTypes.STRING(120), allowNull: true }, // editable por el agente
      bsuid: { type: DataTypes.STRING(64), allowNull: true }, // BSUID WhatsApp (envío a @lid: phone=bsuid)
      agenteDuenoId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      clienteSerfuwebId: { type: DataTypes.STRING(40), allowNull: true }, // cruce con el core
      documento: { type: DataTypes.STRING(20), allowNull: true },
      lineaNegocio: { type: DataTypes.STRING(40), allowNull: true },
      compro: { type: DataTypes.ENUM('si', 'no', 'pendiente'), allowNull: true }, // ¿el cliente compró? (null = sin marcar)
      // Vienen de los errores 130472 y 131049 de las difusiones.
      waExperimento: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      marketingBloqueadoHasta: { type: DataTypes.DATE, allowNull: true },
      bloqueado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      desactivadoEn: { type: DataTypes.DATE, allowNull: true },
      desactivadoPor: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    },
    {
      tableName: 'wa_contactos',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: 'actualizado_en',
    },
  );
