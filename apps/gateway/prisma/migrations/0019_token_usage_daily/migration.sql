CREATE TABLE IF NOT EXISTS token_usage_daily (
  tenant_id UUID NOT NULL,
  date DATE NOT NULL,
  tokens_used BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, date)
);

ALTER TABLE token_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage_daily FORCE ROW LEVEL SECURITY;

CREATE POLICY token_usage_daily_tenant_isolation ON token_usage_daily
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
