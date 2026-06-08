-- 0014_trigger_rules_policy_cleanup: remove stale no-WITH-CHECK policy from 0005
-- 0012 created correct tenant_isolation WITH CHECK but 0005's tenant_isolation_trigger_rules
-- persisted as a duplicate PERMISSIVE policy → OR logic voids WITH CHECK
DROP POLICY IF EXISTS tenant_isolation_trigger_rules ON trigger_rules;
ALTER TABLE trigger_rules FORCE ROW LEVEL SECURITY;
