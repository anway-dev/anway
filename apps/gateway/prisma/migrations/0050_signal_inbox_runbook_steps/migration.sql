-- Confirmed live via independent review: both surface_context (actions.ts)
-- and OncallMorningBrief (cron-monitors.ts) already write to signal_inbox,
-- and run_runbook (actions.ts) already reads from runbook_steps — but
-- neither table was ever migrated. Every one of these writes/reads has
-- been silently failing (queryRaw wrapped in .catch(() => [])) since the
-- code was written, masking a completely broken feature as a quiet no-op
-- instead of a real, actionable failure.

CREATE TABLE signal_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL,
  summary text NOT NULL,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_inbox_tenant_created ON signal_inbox (tenant_id, created_at DESC);

ALTER TABLE signal_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON signal_inbox
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);

CREATE TABLE runbook_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  runbook_name text NOT NULL,
  step integer NOT NULL,
  action_type text NOT NULL,
  action_params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, runbook_name, step)
);

CREATE INDEX idx_runbook_steps_lookup ON runbook_steps (tenant_id, runbook_name, step);

ALTER TABLE runbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON runbook_steps
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);
