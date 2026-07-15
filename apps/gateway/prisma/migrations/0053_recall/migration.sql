-- Recall — Anway's institutional memory. When an incident resolves we store a
-- fingerprint of the signal + its root cause + the fix + time-to-resolve. When
-- a new signal arrives with a matching fingerprint, Anway surfaces "seen N×
-- before, last cause X, fix Y" so triage compounds: each incident makes the
-- next one of its kind faster.

-- Signal fingerprint on the incident (service + alertname + severity, hashed).
-- Set at creation so both the recall lookup (on create) and the recall write
-- (on resolve) share one stable key.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS service text;
CREATE INDEX IF NOT EXISTS incidents_tenant_fingerprint ON incidents (tenant_id, fingerprint);

CREATE TABLE IF NOT EXISTS recall_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  fingerprint  text NOT NULL,
  service      text,
  alertname    text,
  severity     text NOT NULL DEFAULT 'medium',
  root_cause   text,
  fix_action   jsonb,
  ttr_seconds  integer,
  incident_id  uuid,
  resolved_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recall_entries_tenant_fingerprint ON recall_entries (tenant_id, fingerprint);

-- Tenant isolation via RLS, matching every other tenant-scoped table.
ALTER TABLE recall_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE recall_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recall_entries_tenant ON recall_entries;
CREATE POLICY recall_entries_tenant ON recall_entries
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);
