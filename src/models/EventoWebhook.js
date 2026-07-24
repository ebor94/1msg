'use strict';

/**
 * wa_eventos_webhook — bitácora cruda del webhook y cola de la fase 1.
 * El endpoint solo inserta aquí (procesado = 0) y responde 200; el worker
 * la vacía. Se purga a los 60 días, nunca en caliente.
 */
module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'EventoWebhook',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      canalId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      tipo: { type: DataTypes.STRING(60), allowNull: true },
      waMessageId: { type: DataTypes.STRING(128), allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: false },
      procesado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      error: { type: DataTypes.STRING(255), allowNull: true },
      // La base la rellena con DEFAULT CURRENT_TIMESTAMP(3); no la fijamos al insertar.
      recibidoEn: { type: DataTypes.DATE(3), allowNull: true },
    },
    {
      tableName: 'wa_eventos_webhook',
      // Sin timestamps automáticos: recibido_en lo pone MySQL por su DEFAULT.
      timestamps: false,
    },
  );
