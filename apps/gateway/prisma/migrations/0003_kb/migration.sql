-- KB schema: entities, relationships, kb_entries with vector support

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(64) NOT NULL,
  name VARCHAR(512) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel_type VARCHAR(64) NOT NULL,
  to_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE SET NULL,
  source VARCHAR(128) NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_seconds INTEGER NOT NULL DEFAULT 120,
  freshness_score FLOAT NOT NULL DEFAULT 1.0,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_entries ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY tenant_isolation_entities ON entities
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_relationships ON relationships
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation_kb_entries ON kb_entries
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_relationships_traversal ON relationships (from_entity_id, rel_type);
CREATE INDEX IF NOT EXISTS idx_kb_entries_freshness ON kb_entries (tenant_id, freshness_score);
CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities (tenant_id, type, name);

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_kb_entries_embedding ON kb_entries
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
