CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  kind VARCHAR(16) NOT NULL,
  title TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  parent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY artifacts_tenant_isolation ON artifacts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
