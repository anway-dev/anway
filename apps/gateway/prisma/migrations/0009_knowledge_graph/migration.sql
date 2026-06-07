-- 0009_knowledge_graph: entities + relationships tables for StructuralGraph
-- M6-T1: Wire StructuralGraph to real Postgres

CREATE TABLE entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, type, name)
);
CREATE INDEX ON entities (tenant_id);

CREATE TABLE relationships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  from_entity_id  UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel_type        TEXT NOT NULL,
  to_entity_id    UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, from_entity_id, rel_type, to_entity_id)
);
CREATE INDEX ON relationships (tenant_id);
CREATE INDEX ON relationships (from_entity_id);
CREATE INDEX ON relationships (to_entity_id);

-- RLS — tenant isolation (non-negotiable)
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entities AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON relationships AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
