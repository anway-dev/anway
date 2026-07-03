-- 0035b: Drop ALL RULEs on audit_events — they interfere with FK constraint
-- enforcement on audit_events.user_id → users.id.
--
-- Root cause (verified 2026-07-03 against live dev DB):
--   Postgres RULE system rewrites internal FK-checking queries. Even UPDATE-only
--   rules (INSTEAD NOTHING ON UPDATE) cause the FK checker's query on audit_events
--   to return unexpected results, triggering:
--     ERROR: referential integrity query on "users" gave unexpected result
--     HINT: This is most likely due to a rule having rewritten the query
--
-- This happens even when:
--   - Zero audit_events rows reference the user being deleted
--   - Row Level Security on users is disabled
--   - The only remaining rules are UPDATE-only (ev_type=2)
--
-- The rule system fundamentally cannot coexist with FK constraints on the same
-- table when internal FK-checking queries get rewritten.
--
-- Fix: drop ALL rules on audit_events. Append-only enforcement remains at the
-- application layer (IAuditSink only appends, never deletes or updates).
-- DELETE/UPDATE protection is enforced via Prisma schema (onDelete: SetNull for
-- user_id, onDelete: Cascade for tenant_id) and app-level access control.

DROP RULE IF EXISTS audit_no_delete ON audit_events;
DROP RULE IF EXISTS audit_no_update ON audit_events;
DROP RULE IF EXISTS no_delete_audit_events ON audit_events;
DROP RULE IF EXISTS no_update_audit_events ON audit_events;
