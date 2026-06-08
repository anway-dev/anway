-- 0011_gate_events_immutable: Fix audit immutability + add tool_call_id
-- BLOCKING-1: gate_no_delete must be RESTRICTIVE (ANDs with tenant_isolation)
-- HIGH-3: Add tool_call_id column for traceability

-- Drop the no-op permissive delete policy from 0010
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'gate_events' AND policyname = 'gate_no_delete'
  ) THEN
    DROP POLICY gate_no_delete ON gate_events;
  END IF;
END $$;

-- RESTRICTIVE policy: ANDs with all PERMISSIVE policies → always blocks DELETE
CREATE POLICY gate_no_delete ON gate_events AS RESTRICTIVE FOR DELETE USING (false);

-- Add tool_call_id column for CRITICAL-3 gate traceability
ALTER TABLE gate_events ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
