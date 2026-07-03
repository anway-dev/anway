-- 0035b: Drop the audit_no_delete RULE — it interferes with FK constraint
-- enforcement on audit_events.user_id → users.id.
--
-- The RULE redirects ALL DELETE operations on audit_events to INSTEAD NOTHING,
-- including internal FK ON DELETE SET NULL operations. This breaks referential
-- integrity when deleting a user: the FK checker sees audit_events rows still
-- referencing the user (because the RULE silently skipped the SET NULL), and
-- throws:
--   ERROR: referential integrity query on "users" gave unexpected result
--   HINT: This is most likely due to a rule having rewritten the query
--
-- Fix: drop the DELETE RULE. Audit append-only enforcement remains at the
-- application layer (IAuditSink only appends, never deletes). The
-- audit_no_update RULE (preventing UPDATE) is harmless and stays.

DROP RULE IF EXISTS audit_no_delete ON audit_events;
