'use strict';

const { ESTADO_CONVERSACION, ORIGEN_CONVERSACION, DIRECCION } = require('../config/constants');

/**
 * wa_conversaciones. agente_id NULL = bandeja general.
 * Los ultimo_mensaje_* están desnormalizados a propósito: la lista de bandeja
 * no puede hacer JOIN contra mensajes en cada refresco.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'Conversacion',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      canalId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      contactoId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      agenteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true }, // NULL = general
      estado: {
        type: DataTypes.ENUM(...Object.values(ESTADO_CONVERSACION)),
        allowNull: false,
        defaultValue: ESTADO_CONVERSACION.NUEVA,
      },
      origen: {
        type: DataTypes.ENUM(...Object.values(ORIGEN_CONVERSACION)),
        allowNull: false,
        defaultValue: ORIGEN_CONVERSACION.ENTRANTE,
      },
      atendidaPorBot: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // Reloj de las 24h: si ya pasó, la UI obliga a plantilla.
      ventanaExpiraEn: { type: DataTypes.DATE, allowNull: true },
      ultimoMensajeEn: { type: DataTypes.DATE, allowNull: true },
      ultimoMensajeTexto: { type: DataTypes.STRING(255), allowNull: true },
      ultimoMensajeDir: { type: DataTypes.ENUM(...Object.values(DIRECCION)), allowNull: true },
      noLeidos: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      tomadaEn: { type: DataTypes.DATE, allowNull: true },
      historialRecuperadoEn: { type: DataTypes.DATE, allowNull: true },
      historicoCargadoEn: { type: DataTypes.DATE, allowNull: true }, // backfill bajo demanda hecho
      cerradaEn: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'wa_conversaciones',
      timestamps: true,
      createdAt: 'creado_en',
      updatedAt: 'actualizado_en',
    },
  );
