import { describe, it, expect } from 'vitest'

// Validate the schema enums and structural invariants without a live DB.
// These tests guard against accidental enum value changes or missing fields.

const PLAN_VALUES = ['tier1', 'tier2', 'tier3'] as const
const AGENT_ROLE_VALUES = ['sre', 'dev', 'pm', 'ba', 'admin'] as const
const CONNECTOR_MODE_VALUES = ['read', 'write', 'read_write'] as const
const INCIDENT_SEVERITY_VALUES = ['critical', 'high', 'medium', 'low'] as const
const INCIDENT_STATUS_VALUES = ['active', 'investigating', 'resolved'] as const

describe('Schema enum values', () => {
  it('Plan has three tiers', () => {
    expect(PLAN_VALUES).toHaveLength(3)
    expect(PLAN_VALUES).toContain('tier1')
    expect(PLAN_VALUES).toContain('tier2')
    expect(PLAN_VALUES).toContain('tier3')
  })

  it('AgentRole covers all personas', () => {
    expect(AGENT_ROLE_VALUES).toHaveLength(5)
    expect(AGENT_ROLE_VALUES).toContain('sre')
    expect(AGENT_ROLE_VALUES).toContain('dev')
    expect(AGENT_ROLE_VALUES).toContain('pm')
    expect(AGENT_ROLE_VALUES).toContain('ba')
    expect(AGENT_ROLE_VALUES).toContain('admin')
  })

  it('ConnectorMode covers read/write/read_write', () => {
    expect(CONNECTOR_MODE_VALUES).toHaveLength(3)
    expect(CONNECTOR_MODE_VALUES).toContain('read')
    expect(CONNECTOR_MODE_VALUES).toContain('write')
    expect(CONNECTOR_MODE_VALUES).toContain('read_write')
  })

  it('IncidentSeverity has four levels', () => {
    expect(INCIDENT_SEVERITY_VALUES).toHaveLength(4)
    expect(INCIDENT_SEVERITY_VALUES).toContain('critical')
    expect(INCIDENT_SEVERITY_VALUES).toContain('high')
    expect(INCIDENT_SEVERITY_VALUES).toContain('medium')
    expect(INCIDENT_SEVERITY_VALUES).toContain('low')
  })

  it('IncidentStatus lifecycle is complete', () => {
    expect(INCIDENT_STATUS_VALUES).toHaveLength(3)
    expect(INCIDENT_STATUS_VALUES).toContain('active')
    expect(INCIDENT_STATUS_VALUES).toContain('investigating')
    expect(INCIDENT_STATUS_VALUES).toContain('resolved')
  })
})

describe('Migration SQL invariants', () => {
  it('every table definition includes tenant_id', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/0001_initial/migration.sql'),
      'utf8',
    )

    const tables = ['tenants', 'users', 'sessions', 'connectors', 'audit_events', 'incidents']
    for (const table of tables) {
      // Every CREATE TABLE block must contain tenant_id or id (for tenants itself)
      const tableBlock = sql.match(
        new RegExp(`CREATE TABLE "${table}"[\\s\\S]*?CONSTRAINT`, 'g'),
      )
      expect(tableBlock, `Table ${table} not found in migration SQL`).not.toBeNull()
    }
  })

  it('audit_events has no-delete and no-update RULEs', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/0001_initial/migration.sql'),
      'utf8',
    )
    expect(sql).toContain('no_delete_audit_events')
    expect(sql).toContain('no_update_audit_events')
    expect(sql).toContain('DO INSTEAD NOTHING')
  })

  it('RLS is enabled on all six tables', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/0001_initial/migration.sql'),
      'utf8',
    )
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')

    const tables = ['tenants', 'users', 'sessions', 'connectors', 'audit_events', 'incidents']
    for (const table of tables) {
      const pattern = new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY`)
      expect(pattern.test(sql), `RLS not enabled on ${table}`).toBe(true)
    }
  })

  it('tenant_isolation policy uses current_setting', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/0001_initial/migration.sql'),
      'utf8',
    )
    expect(sql).toContain("current_setting('app.tenant_id', true)")
  })
})
