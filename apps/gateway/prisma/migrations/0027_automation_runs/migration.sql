CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  kind VARCHAR(16) NOT NULL,        -- 'cron' | 'trigger'
  ref_id UUID NOT NULL,             -- cron_jobs.id or trigger_rules.id
  status VARCHAR(32) NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX automation_runs_ref ON automation_runs (tenant_id, kind, ref_id, started_at DESC);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY automation_runs_tenant_isolation ON automation_runs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
