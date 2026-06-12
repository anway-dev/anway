ALTER TABLE connector_config ADD COLUMN IF NOT EXISTS credentials_enc TEXT;
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS config_enc TEXT;
ALTER TABLE provider_config ADD COLUMN IF NOT EXISTS api_key_enc TEXT;
