-- 0018_bootstrap_summary: add last_bootstrap_summary to connector_config
ALTER TABLE connector_config ADD COLUMN last_bootstrap_summary JSONB;
