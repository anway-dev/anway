-- Force RLS on gate_policies and automation_runs so the DB-level tenant
-- isolation backstop applies even for the table owner role (Prisma/app role).
-- Every other tenant-scoped table already has FORCE ROW LEVEL SECURITY;
-- these two were missed in their original migrations.

ALTER TABLE gate_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
