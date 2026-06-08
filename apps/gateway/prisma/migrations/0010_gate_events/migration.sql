-- 0010_gate_events: L2 gate persistence for V1 trust contract
CREATE TABLE gate_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL,
  session_id  UUID NOT NULL,
  tool_name   TEXT NOT NULL,
  tool_args   JSONB NOT NULL DEFAULT '{}',
  connector_id TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | timeout
  decided_by  UUID,
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON gate_events (tenant_id);
CREATE INDEX ON gate_events (status);

-- RLS — tenant isolation
ALTER TABLE gate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gate_events AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Audit — gate decisions are immutable (no UPDATE without where; only status transitions allowed)
CREATE POLICY gate_no_delete ON gate_events AS PERMISSIVE FOR DELETE
  USING (false);
