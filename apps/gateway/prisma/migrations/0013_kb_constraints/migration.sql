-- 0013_kb_constraints: UNIQUE constraints + RLS WITH CHECK for 0003_kb tables

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_unique_per_tenant') THEN
    ALTER TABLE entities ADD CONSTRAINT entities_unique_per_tenant UNIQUE (tenant_id, type, name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationships_unique_per_tenant') THEN
    ALTER TABLE relationships ADD CONSTRAINT relationships_unique_per_tenant
      UNIQUE (tenant_id, from_entity_id, rel_type, to_entity_id);
  END IF;
END $$;

ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON entities;
CREATE POLICY tenant_isolation ON entities AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON relationships;
CREATE POLICY tenant_isolation ON relationships AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON kb_entries;
CREATE POLICY tenant_isolation ON kb_entries AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
