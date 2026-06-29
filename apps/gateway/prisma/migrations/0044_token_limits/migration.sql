-- Add per-query and per-session token limits to tenants.
-- NULL means unlimited (no hard cap).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS per_query_token_limit INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS per_session_token_limit INTEGER;
