CREATE TABLE gate_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  scope VARCHAR(128) NOT NULL DEFAULT '*',
  approvers_required INT NOT NULL DEFAULT 1,
  auto_approve_threshold DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope)
);
ALTER TABLE gate_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY gate_policies_tenant_isolation ON gate_policies
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
