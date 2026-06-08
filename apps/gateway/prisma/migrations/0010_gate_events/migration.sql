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
