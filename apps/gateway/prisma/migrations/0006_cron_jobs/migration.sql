CREATE TABLE cron_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  schedule    TEXT NOT NULL DEFAULT '0 */5 * * *',
  job_type    TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX ON cron_jobs (tenant_id);
