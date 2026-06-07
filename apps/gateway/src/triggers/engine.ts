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
      if (payload[key] !== value) return false
    }
    return true
  }
}
