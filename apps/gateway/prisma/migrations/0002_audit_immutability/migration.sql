-- Prevent deletion of audit events (immutability guarantee)
CREATE OR REPLACE FUNCTION prevent_audit_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable — deletion not permitted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_delete_audit_events
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete();

-- Change FK to RESTRICT (prevents cascade deletion)
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_tenant_id_fkey;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
