-- 0017_provider_connector_config: DB-backed provider + connector settings
-- Replaces env-var-only provider config. Connector credentials stored encrypted in DB.

CREATE TABLE provider_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      VARCHAR(50) NOT NULL,
  api_key       TEXT,
  base_url      TEXT,
  default_model VARCHAR(100),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);
ALTER TABLE provider_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_config FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_config_tenant ON provider_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE connector_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connector_type  VARCHAR(50) NOT NULL,
  credentials     JSONB NOT NULL DEFAULT '{}',
  enabled         BOOLEAN NOT NULL DEFAULT false,
  bootstrapped_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, connector_type)
);
ALTER TABLE connector_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_config FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_config_tenant ON connector_config
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
