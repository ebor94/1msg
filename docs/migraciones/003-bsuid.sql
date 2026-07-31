-- =====================================================================
-- Migración 003 (2026-07-31): BSUID de WhatsApp en wa_contactos.
-- WhatsApp está migrando de teléfono a BSUID (identificador de privacidad).
-- Para contactos con número oculto (@lid) se envía con phone = bsuid; 1msg lo
-- mapea al teléfono real y entrega. El bsuid llega en cada entrante (authorBsuid).
-- =====================================================================

ALTER TABLE wa_contactos
  ADD COLUMN bsuid VARCHAR(64) NULL AFTER nombre_display;

-- Backfill: para los contactos @lid ya existentes, el bsuid es el wa_id sin '@lid'
-- (authorBsuid = chatId sin el sufijo). Así los chats @lid actuales ya pueden responder.
UPDATE wa_contactos
   SET bsuid = REPLACE(wa_id, '@lid', '')
 WHERE wa_id LIKE '%@lid' AND (bsuid IS NULL OR bsuid = '');
