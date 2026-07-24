'use strict';

const { ROL_AGENTE } = require('../config/constants');

/**
 * wa_agentes — los usuarios de serfuweb que son agentes de WhatsApp (~15 de 40).
 * Tabla puente: `usuario_id` referencia (blanda) a serfuweb.usuarios.id; la
 * identidad (nombre/email/activo) vive allá, aquí van los campos de WhatsApp.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Agente',
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      // Enlace blando a serfuweb.usuarios.id (sin FK dura, para no acoplar el core).
      usuarioId: { type: DataTypes.INTEGER, allowNull: true, unique: true },
      usuario: { type: DataTypes.STRING(60), allowNull: false, unique: true }, // = serfuweb.usuarios.email (login)
      nombre: { type: DataTypes.STRING(120), allowNull: false },
      email: { type: DataTypes.STRING(150), allowNull: true },
      // Prefijo en mensajes salientes (ej. "Ana | ") porque comparten número.
      firma: { type: DataTypes.STRING(60), allowNull: true },
      rol: {
        type: DataTypes.ENUM(...Object.values(ROL_AGENTE)),
        allowNull: false,
        defaultValue: ROL_AGENTE.ASESOR,
      },
      lineaNegocio: { type: DataTypes.STRING(40), allowNull: true },
      sede: { type: DataTypes.STRING(60), allowNull: true },
      maxChats: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 50 },
      disponible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ultimaConexion: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'wa_agentes',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: false,
    },
  );
