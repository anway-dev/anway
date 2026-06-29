-- Allow null monthly budget — null means unlimited (no hard cap)
ALTER TABLE tenants ALTER COLUMN token_budget_monthly DROP NOT NULL;
ALTER TABLE tenants ALTER COLUMN token_budget_monthly DROP DEFAULT;
