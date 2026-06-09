-- 0016_kb_entries_force_rls: add FORCE ROW LEVEL SECURITY to kb_entries
-- All other data tables already have FORCE RLS. kb_entries was missed.

ALTER TABLE kb_entries FORCE ROW LEVEL SECURITY;
