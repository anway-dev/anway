-- gate_policies.approvers_required was stored (CRUD via routes/gate-policies.ts)
-- but never enforced anywhere — every gate resolved on exactly one approval
-- regardless of configured policy, confirmed live via independent review. A
-- single gate_events row (status + one decided_by) can't represent "2 of 3
-- required approvals received" at all; this table tracks each distinct
-- approver's vote so the decide route can count them against the policy
-- before actually flipping gate_events.status to 'approved'.
CREATE TABLE gate_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id uuid NOT NULL REFERENCES gate_events(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  approver_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gate_id, approver_id)
);

CREATE INDEX idx_gate_approvals_gate ON gate_approvals (tenant_id, gate_id);

ALTER TABLE gate_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gate_approvals
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id', true))::uuid);
