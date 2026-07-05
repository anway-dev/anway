-- Multi-instance connector support (MCP/CLI-backed connectors are a
-- template — many differently-configured instances of the same
-- connector_type can be registered, e.g. two separate MCP servers backing
-- two different customer services). The prior unique constraint
-- (tenant_id, connector_type, env_id) allowed exactly one row per type per
-- tenant per environment, which is correct for singleton native connectors
-- (one GitHub org, one Datadog account) but structurally forbade a second
-- instance of the same type — confirmed live as the root cause of "only one
-- MCP connector possible."
--
-- instance_name backfills to connector_type for every existing row, so
-- existing singleton connectors keep their exact current unique-key
-- behavior unchanged (still effectively one row per type, since the app
-- layer will only ever pass a non-default instance_name for types that are
-- genuinely instantiable multiple times, i.e. mcp/cli).

ALTER TABLE connector_config ADD COLUMN instance_name VARCHAR(100);
UPDATE connector_config SET instance_name = connector_type WHERE instance_name IS NULL;
ALTER TABLE connector_config ALTER COLUMN instance_name SET NOT NULL;

DROP INDEX IF EXISTS connector_config_tenant_type_env;

CREATE UNIQUE INDEX connector_config_tenant_type_instance_env
  ON connector_config (tenant_id, connector_type, instance_name, COALESCE(env_id, '00000000-0000-0000-0000-000000000000'::uuid));
