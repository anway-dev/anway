-- Per-user git credentials (GitHub PAT, GitLab token, etc.)
-- Encrypted with the same AES key as connector credentials.
-- Users can push code via Anway editor without exposing tokens to other team members.
CREATE TABLE IF NOT EXISTS user_git_credentials (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT        NOT NULL DEFAULT 'github',
  username    TEXT,
  email       TEXT,
  token_enc   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_git_cred UNIQUE (tenant_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_git_cred_tenant_user ON user_git_credentials(tenant_id, user_id);

ALTER TABLE user_git_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_git_cred_tenant ON user_git_credentials
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
