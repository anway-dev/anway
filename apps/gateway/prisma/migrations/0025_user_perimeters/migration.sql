CREATE TABLE user_perimeters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  connector_name TEXT NOT NULL,
  read_scopes TEXT[] NOT NULL DEFAULT '{}',
  write_scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, connector_name)
);
ALTER TABLE user_perimeters ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_perimeters FORCE ROW LEVEL SECURITY;
CREATE POLICY user_perimeters_tenant_isolation ON user_perimeters
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
