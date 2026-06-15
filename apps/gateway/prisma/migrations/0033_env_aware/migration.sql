-- Environments: first-class tenant-managed list of deployment environments
-- User creates/names/orders these; system does not auto-create from connectors.
CREATE TABLE environments (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID    NOT NULL,
  name       TEXT    NOT NULL,  -- slug: 'staging', 'preprod', 'prod'
  label      TEXT    NOT NULL,  -- display: 'Staging', 'Pre-production', 'Production'
  color      TEXT    NOT NULL DEFAULT '#888888',
  sort_order INT     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments FORCE ROW LEVEL SECURITY;
CREATE POLICY environments_tenant ON environments
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE UNIQUE INDEX environments_tenant_name ON environments(tenant_id, name);

-- connector_config: add env_id (NULL = global connector, not env-scoped)
ALTER TABLE connector_config ADD COLUMN env_id UUID REFERENCES environments(id) ON DELETE SET NULL;

-- Drop old unique constraint (type per tenant) — now type can exist once globally OR once per env
ALTER TABLE connector_config DROP CONSTRAINT IF EXISTS connector_config_tenant_id_connector_type_key;

-- New unique: (tenant, type, env) — global rows use sentinel null
CREATE UNIQUE INDEX connector_config_tenant_type_env
  ON connector_config(tenant_id, connector_type, COALESCE(env_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Seed default environments for all existing tenants
INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
SELECT gen_random_uuid(), id, 'staging', 'Staging', '#3b82f6', 0 FROM tenants
ON CONFLICT DO NOTHING;

INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
SELECT gen_random_uuid(), id, 'preprod', 'Pre-production', '#f59e0b', 1 FROM tenants
ON CONFLICT DO NOTHING;

INSERT INTO environments (id, tenant_id, name, label, color, sort_order)
SELECT gen_random_uuid(), id, 'prod', 'Production', '#ef4444', 2 FROM tenants
ON CONFLICT DO NOTHING;
