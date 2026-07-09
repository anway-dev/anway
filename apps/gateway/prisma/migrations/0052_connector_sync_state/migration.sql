-- Ongoing-sync state for connectors (webhook auto-registration + polling
-- fallback + event-silence visibility).
--
-- Confirmed via independent review: no connector ever registered a webhook
-- with its vendor and nothing polled for changes post-bootstrap — the graph
-- was a one-shot snapshot per connector, refreshed only by kb:stale
-- re-bootstraps. CLAUDE.md: "After bootstrap, connector registers event
-- subscriptions for ongoing graph updates."
--
--   sync_state: jsonb — webhook registration record (vendor hook id,
--     encrypted per-connector webhook secret, registeredAt) and the polling
--     fallback's incremental cursor. One column, connector-type-specific
--     shape, same pattern as capability_manifest.
--   last_event_received_at: stamped every time a real vendor event arrives
--     for this connector (webhook or poll) — silence becomes visible in the
--     connectors UI instead of a stale graph looking identical to a quiet
--     org.

ALTER TABLE connector_config
  ADD COLUMN sync_state jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN last_event_received_at timestamptz;
