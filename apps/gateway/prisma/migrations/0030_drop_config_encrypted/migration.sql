-- Drop legacy plaintext config column from connectors table.
-- All new connectors use config_enc (AES-256-GCM encrypted String).
-- config_encrypted (Json) was the original unencrypted storage — now obsolete.
ALTER TABLE "connectors" DROP COLUMN IF EXISTS "config_encrypted";
