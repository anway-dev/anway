export interface TriggerRule {
  id: string
  tenantId: string
  eventType: string
  condition: Record<string, unknown>
  actions: TriggerAction[]
  enabled: boolean
}

export interface TriggerAction {
  type: 'notify_oncall' | 'create_incident' | 'surface_context' | 'run_runbook'
  params: Record<string, unknown>
}

interface ConditionEntry { field: string; operator?: string; value: unknown }

export class TriggerEngine {
  private rules: TriggerRule[] = []

  loadRules(rules: TriggerRule[]): void {
    this.rules = rules
  }

  async evaluate(eventType: string, payload: Record<string, unknown>): Promise<TriggerAction[]> {
    const matched: TriggerAction[] = []
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      if (rule.eventType !== eventType) continue
      if (this.matchesCondition(rule.condition, payload)) {
        matched.push(...rule.actions)
      }
    }
    return matched
  }

  private matchesCondition(condition: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(condition)) {
      // Support new format: { field: 'severity', operator: 'gt', value: 3 }
      const entry = value as ConditionEntry
      if (entry && typeof entry === 'object' && 'field' in entry) {
        const actual = payload[entry.field]
        switch (entry.operator ?? 'eq') {
          case 'eq': if (actual !== entry.value) return false; break
          case 'gt': if (typeof actual !== 'number' || actual <= Number(entry.value)) return false; break
          case 'lt': if (typeof actual !== 'number' || actual >= Number(entry.value)) return false; break
          case 'contains': if (typeof actual !== 'string' || !actual.includes(String(entry.value))) return false; break
          case 'exists': if (actual === undefined || actual === null) return false; break
          default: if (actual !== entry.value) return false
        }
      } else {
        // Legacy format: plain key-value equality
        if (payload[key] !== value) return false
      }
    }
    return true
  }
}
