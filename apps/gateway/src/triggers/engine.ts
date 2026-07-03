export interface TriggerPerimeter {
  connectorId: string
  read: string[]
  write: string[]
}

export interface TriggerRule {
  id: string
  tenantId: string
  eventType: string
  condition: Record<string, unknown>
  actions: TriggerAction[]
  enabled: boolean
  perimeter?: TriggerPerimeter[] | null
}

export interface TriggerAction {
  type: 'notify_oncall' | 'create_incident' | 'surface_context' | 'run_runbook' | 'notify_channel' | 'escalate' | 'block_deploy_gate' | 'open_war_room'
  params: Record<string, unknown>
}

interface ConditionEntry { field: string; operator?: string; value: unknown }

export class TriggerEngine {
  private rules: TriggerRule[] = []

  loadRules(rules: TriggerRule[]): void {
    this.rules = rules
  }

  async evaluate(eventType: string, payload: Record<string, unknown>): Promise<{ actions: TriggerAction[]; perimeters: TriggerPerimeter[] }> {
    const matched: TriggerAction[] = []
    const perimeters: TriggerPerimeter[] = []
    for (const rule of this.rules) {
      if (!rule.enabled) continue
      if (rule.eventType !== eventType) continue
      if (this.matchesCondition(rule.condition, payload)) {
        matched.push(...rule.actions)
        if (rule.perimeter) perimeters.push(...rule.perimeter)
      }
    }
    return { actions: matched, perimeters }
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
