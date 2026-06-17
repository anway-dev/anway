-- Deduplication constraint for session_turns — prevents identical turns
-- from being inserted twice within the same timestamp (best-effort idempotency).
ALTER TABLE session_turns
  ADD CONSTRAINT session_turns_dedup
  UNIQUE (tenant_id, session_id, role, content, created_at);
