CREATE TABLE session_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_session_turns_session ON session_turns(tenant_id, session_id, created_at);

ALTER TABLE session_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_turns FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON session_turns
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
