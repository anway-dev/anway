-- Add perimeter column to trigger_rules
-- Stores the creating user's connector perimeter scope as JSONB snapshot.
-- Used by trigger engine to scope automated actions to the creator's access envelope.
ALTER TABLE trigger_rules ADD COLUMN IF NOT EXISTS perimeter JSONB;

-- Also add optional name column for display in automations UI
ALTER TABLE trigger_rules ADD COLUMN IF NOT EXISTS name TEXT;
