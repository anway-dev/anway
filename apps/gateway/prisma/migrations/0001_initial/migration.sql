-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('tier1', 'tier2', 'tier3');

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('sre', 'dev', 'pm', 'ba', 'admin');

-- CreateEnum
CREATE TYPE "ConnectorMode" AS ENUM ('read', 'write', 'read_write');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('active', 'investigating', 'resolved');

-- CreateTable
CREATE TABLE "tenants" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"                 TEXT        NOT NULL,
    "slug"                 TEXT        NOT NULL,
    "plan"                 "Plan"      NOT NULL DEFAULT 'tier1',
    "token_budget_monthly" INTEGER     NOT NULL DEFAULT 1000000,
    "connector_limit"      INTEGER     NOT NULL DEFAULT 3,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID        NOT NULL,
    "email"      TEXT        NOT NULL,
    "role"       "AgentRole" NOT NULL DEFAULT 'dev',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID        NOT NULL,
    "tenant_id"  UUID        NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id"                  UUID            NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID            NOT NULL,
    "name"                TEXT            NOT NULL,
    "type"                TEXT            NOT NULL,
    "mode"                "ConnectorMode" NOT NULL DEFAULT 'read',
    "config_encrypted"    JSONB           NOT NULL DEFAULT '{}',
    "capability_manifest" JSONB           NOT NULL DEFAULT '{}',
    "created_at"          TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID        NOT NULL,
    "user_id"    UUID,
    "session_id" UUID,
    "event_type" TEXT        NOT NULL,
    "payload"    JSONB       NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id"          UUID                NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID                NOT NULL,
    "title"       TEXT                NOT NULL,
    "severity"    "IncidentSeverity"  NOT NULL DEFAULT 'medium',
    "status"      "IncidentStatus"    NOT NULL DEFAULT 'active',
    "created_at"  TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "connectors_tenant_id_idx" ON "connectors"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_idx" ON "audit_events"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "incidents_tenant_id_idx" ON "incidents"("tenant_id");

-- CreateIndex
CREATE INDEX "incidents_tenant_id_status_idx" ON "incidents"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- Row-Level Security: tenant isolation on all user-data tables
-- Policy uses current_setting('app.tenant_id') set per-request by gateway
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents    ENABLE ROW LEVEL SECURITY;

-- Bypass RLS for Postgres superuser during migrations/seed only
-- Application connects as non-superuser role; RLS is enforced for it
ALTER TABLE tenants      FORCE ROW LEVEL SECURITY;
ALTER TABLE users        FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions     FORCE ROW LEVEL SECURITY;
ALTER TABLE connectors   FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents    FORCE ROW LEVEL SECURITY;

-- tenants: row visible only when id matches the session-scoped tenant
CREATE POLICY tenant_isolation ON tenants
  AS PERMISSIVE FOR ALL
  USING (id = current_setting('app.tenant_id', true)::uuid);

-- users: scoped to current tenant
CREATE POLICY tenant_isolation ON users
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- sessions: scoped to current tenant
CREATE POLICY tenant_isolation ON sessions
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- connectors: scoped to current tenant
CREATE POLICY tenant_isolation ON connectors
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- audit_events: scoped to current tenant
CREATE POLICY tenant_isolation ON audit_events
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- incidents: scoped to current tenant
CREATE POLICY tenant_isolation ON incidents
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─────────────────────────────────────────────────────────────────
-- audit_events: immutable append-only enforcement
-- RULE redirects DELETE and UPDATE to NOTHING so the table can
-- never be modified — only inserted. Applies even to table owner.
-- ─────────────────────────────────────────────────────────────────

CREATE RULE no_delete_audit_events AS
    ON DELETE TO audit_events DO INSTEAD NOTHING;

CREATE RULE no_update_audit_events AS
    ON UPDATE TO audit_events DO INSTEAD NOTHING;
