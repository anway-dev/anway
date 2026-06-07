-- Add WITH CHECK to audit_events RLS policy so INSERT is tenant-scoped at DB level.
-- Previously only USING was set, which controlled visibility but not insert validation.
ALTER POLICY tenant_isolation ON audit_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
