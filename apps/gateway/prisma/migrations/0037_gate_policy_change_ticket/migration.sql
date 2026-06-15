ALTER TABLE gate_policies ADD COLUMN IF NOT EXISTS require_change_ticket BOOLEAN NOT NULL DEFAULT false;
