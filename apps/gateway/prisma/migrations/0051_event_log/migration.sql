-- Durable event log (outbox pattern) + per-consumer claim table.
--
-- Confirmed via independent review: every domain event (pr_merged,
-- deploy_completed, incident_created, connector_registered, ...) rode
-- fire-and-forget Redis pub/sub with no durable record — a gateway restart
-- mid-event permanently lost the event (stale graph until a manual resync),
-- and with >1 gateway replica every replica processed every message (the
-- graph-builder bootstrap path had its own in-progress guard; the other 14
-- event handlers had no dedupe at all). CLAUDE.md's own storage table
-- already promised "Postgres (event log, invalidation triggers, durable
-- record)" — this table is that record.
--
-- Flow: publisher INSERTs here first (outbox), then publishes to Redis with
-- the event_log id attached. Consumers claim via event_consumptions
-- (INSERT ... ON CONFLICT DO NOTHING — exactly one replica wins). A replayer
-- job re-publishes rows past a grace period with zero consumptions
-- (bounded by replay_count), so a crash between INSERT and publish — or a
-- subscriber that was down — heals automatically.

CREATE TABLE event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  replay_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_log_created ON event_log (created_at);
CREATE INDEX idx_event_log_tenant ON event_log (tenant_id, created_at DESC);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_log
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);

CREATE TABLE event_consumptions (
  event_id uuid NOT NULL REFERENCES event_log(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  consumer text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

CREATE INDEX idx_event_consumptions_tenant ON event_consumptions (tenant_id);

ALTER TABLE event_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_consumptions
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);
