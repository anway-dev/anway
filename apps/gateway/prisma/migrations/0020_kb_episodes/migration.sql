CREATE TABLE IF NOT EXISTS kb_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE kb_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_episodes FORCE ROW LEVEL SECURITY;
CREATE POLICY kb_episodes_tenant_isolation ON kb_episodes
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE INDEX kb_episodes_tenant_created ON kb_episodes (tenant_id, created_at DESC);
