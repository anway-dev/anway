CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  stages JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL DEFAULT 'idle',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipelines FORCE ROW LEVEL SECURITY;
CREATE POLICY pipelines_tenant_isolation ON pipelines
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE pipeline_stage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  stage_id TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  output JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
ALTER TABLE pipeline_stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY pipeline_stage_runs_tenant_isolation ON pipeline_stage_runs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE INDEX pipeline_stage_runs_pipeline_id ON pipeline_stage_runs (pipeline_id);
