CREATE TABLE IF NOT EXISTS trigger_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  condition JSONB NOT NULL DEFAULT '{}',
  actions JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trigger_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_trigger_rules ON trigger_rules
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

CREATE INDEX IF NOT EXISTS idx_trigger_rules_tenant_event ON trigger_rules (tenant_id, event_type);
