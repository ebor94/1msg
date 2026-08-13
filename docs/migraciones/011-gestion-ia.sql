-- Gestionar con IA: flag por contacto + borrador de respuesta por conversación.
ALTER TABLE wa_contactos
  ADD COLUMN gestionar_con_ia TINYINT(1) NOT NULL DEFAULT 0 AFTER compro;

ALTER TABLE wa_conversaciones
  ADD COLUMN borrador_ia TEXT NULL,
  ADD COLUMN borrador_ia_en DATETIME NULL;

-- Prompt de rol editable (sin desplegar). Semilla por defecto.
INSERT INTO wa_ajustes (clave, valor)
VALUES ('ia_gestion_prompt',
  'Eres un asistente de atención al cliente de Los Olivos Cúcuta (servicios exequiales y de cartera) que redacta, en español y en tono cordial y breve, una posible respuesta de la empresa al último mensaje del cliente en WhatsApp. No inventes datos concretos (saldos, fechas, montos) que no aparezcan en la conversación; si el cliente los pide, ofrece verificarlo. No hagas promesas ni compromisos en nombre de la empresa. Responde SOLO con el texto sugerido para enviar, sin preámbulos ni comillas.')
ON DUPLICATE KEY UPDATE clave = clave;
