-- connector_config had no capability_manifest column at all — the separate
-- `connectors` table has one and is what chat.ts's perimeter reads, but
-- connector_config (what bootstrap/graph-builder/native-connector-tools all
-- actually use, including mcp/cli) had nowhere to persist a classified
-- toolRoleMap for per-tool default-deny enforcement. Adding it here rather
-- than migrating the whole native-connector pipeline onto the `connectors`
-- table, since connector_config is the one the real, working bootstrap
-- pipeline is built on.
ALTER TABLE connector_config ADD COLUMN capability_manifest JSONB NOT NULL DEFAULT '{}'::jsonb;
