-- Add env_id to every table that is scoped to a deployment environment.
-- env_id references environments.id (UUID) — the internal stable key.
-- env.name (slug) is customer-visible and admin-editable; env.label is the display name.
-- NULL env_id = global (not env-scoped — e.g., source-control incidents, org-wide KB entries).

-- incidents — associated with an environment
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- gate_events — gate decisions happen in a specific environment
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- gate_policies — policies are per-environment
ALTER TABLE gate_policies ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- artifacts (PRDs, TechSpecs, etc.) — belong to a service/pipeline; some are env-specific
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- pipeline_stage_runs — already has stage.env field in JSONB; add env_id for SQL scoping
ALTER TABLE pipeline_stage_runs ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- pipelines — a pipeline promotes across environments; store the primary env (first stage)
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS current_env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- entities (Knowledge Graph nodes) — Service entities belong to an environment
ALTER TABLE entities ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- relationships — env-scoped when both source and target are env-scoped
ALTER TABLE relationships ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- kb_entries — knowledge entries can be env-specific (e.g., "staging runbook")
ALTER TABLE kb_entries ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- user_perimeters — access rules are per-environment (can deploy to staging but not prod)
ALTER TABLE user_perimeters ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- cron_jobs (monitors) — monitors run against a specific environment
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- automation_runs — automation executions are env-scoped
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- Indexes for efficient env-filtered queries
CREATE INDEX IF NOT EXISTS incidents_env_id ON "incidents" (env_id);
CREATE INDEX IF NOT EXISTS gate_events_env_id ON gate_events (env_id);
CREATE INDEX IF NOT EXISTS entities_env_id ON entities (env_id);
CREATE INDEX IF NOT EXISTS kb_entries_env_id ON kb_entries (env_id);
CREATE INDEX IF NOT EXISTS user_perimeters_env_id ON user_perimeters (env_id);
CREATE INDEX IF NOT EXISTS cron_jobs_env_id ON cron_jobs (env_id);
CREATE INDEX IF NOT EXISTS pipelines_current_env_id ON pipelines (current_env_id);
