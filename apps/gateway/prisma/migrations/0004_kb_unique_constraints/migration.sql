ALTER TABLE entities ADD CONSTRAINT entities_tenant_type_name_unique
  UNIQUE (tenant_id, type, name);

ALTER TABLE relationships ADD CONSTRAINT relationships_edge_unique
  UNIQUE (from_entity_id, rel_type, to_entity_id);
