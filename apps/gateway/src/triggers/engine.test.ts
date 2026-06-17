import { describe, it, expect } from 'vitest'
import { TriggerEngine } from './engine.js'
import type { TriggerRule } from './engine.js'

describe('TriggerEngine', () => {
  describe('matchesCondition', () => {
    it('returns true when condition matches payload', async () => {
      const rules: TriggerRule[] = [{
        id: '1', tenantId: 't1', eventType: 'alert_fired',
        condition: { severity: 'critical' }, actions: [{ type: 'notify_oncall', params: {} }],
        enabled: true,
      }]
      const engine = new TriggerEngine()
      engine.loadRules(rules)
      const result = await engine.evaluate('alert_fired', { severity: 'critical' })
      expect(result.actions).toHaveLength(1)
    })

    it('returns empty when no condition matches', async () => {
      const rules: TriggerRule[] = [{
        id: '1', tenantId: 't1', eventType: 'alert_fired',
        condition: { severity: 'low' }, actions: [{ type: 'notify_oncall', params: {} }],
        enabled: true,
      }]
      const engine = new TriggerEngine()
      engine.loadRules(rules)
      const result = await engine.evaluate('alert_fired', { severity: 'critical' })
      expect(result.actions).toHaveLength(0)
    })

    it('ignores disabled rules', async () => {
      const rules: TriggerRule[] = [{
        id: '1', tenantId: 't1', eventType: 'alert_fired',
        condition: {}, actions: [{ type: 'notify_oncall', params: {} }],
        enabled: false,
      }]
      const engine = new TriggerEngine()
      engine.loadRules(rules)
      const result = await engine.evaluate('alert_fired', {})
      expect(result.actions).toHaveLength(0)
    })
  })
})
