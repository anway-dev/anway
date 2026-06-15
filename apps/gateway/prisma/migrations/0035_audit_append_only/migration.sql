-- Prevent UPDATE and DELETE on audit_events at the database level.
-- Silent no-op (INSTEAD NOTHING) — returns success but does nothing.
-- This is defense-in-depth: the app layer never mutates audit rows,
-- but this makes it structurally impossible at DB level.

CREATE OR REPLACE RULE audit_no_update AS
  ON UPDATE TO audit_events DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_no_delete AS
  ON DELETE TO audit_events DO INSTEAD NOTHING;
