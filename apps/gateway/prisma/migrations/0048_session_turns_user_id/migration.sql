-- session_turns had no user_id column at all — any authenticated user in a
-- tenant could list, read, and delete every other user's chat history via
-- /api/sessions (confirmed live via independent review: every query there
-- scopes only by tenant_id). Nullable since existing rows have no real
-- owner to backfill; new writes (routes/chat.ts) always set it.
ALTER TABLE session_turns ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_session_turns_user ON session_turns (tenant_id, user_id, session_id, created_at);
