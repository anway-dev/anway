import type { IModelProvider } from '../interfaces/provider.js'

export interface IncidentContext {
  hypothesis: string
  timeline: TimelineEvent[]
  relatedDeploys: string[]
  relatedPRs: string[]
  suggestedRunbook: string[]
}

export interface TimelineEvent {
  time: Date
  source: string
  event: string
}

/**
 * SREAgent — assembles incident context from connector data.
 * Uses cheap model for connector summarisation, expensive model for final hypothesis.
 */
export class SREAgent {
  constructor(
    private readonly cheapModel: IModelProvider,
    private readonly mainModel: IModelProvider,
    private readonly cheapModelId = 'claude-haiku-3-5-20251001',
    private readonly mainModelId = 'claude-sonnet-4-6',
  ) {}

  async assembleContext(alertTitle: string, alertDescription: string): Promise<IncidentContext> {
    const entityExtraction = await this.cheapModel.chat([
      { role: 'system', content: 'Extract service name, team, and any error type from this alert. Respond with comma-separated values only.' },
      { role: 'user', content: `${alertTitle}: ${alertDescription}` },
    ], [], { model: this.cheapModelId, maxTokens: 50, temperature: 0 })

    const entities = entityExtraction.content.split(',').map(s => s.trim()).filter(Boolean)

    const hypothesisResult = await this.mainModel.chat([
      { role: 'system', content: `You are an SRE analyzing an incident. Based on the alert information provided, produce a grounded root cause hypothesis. Format: hypothesis, possible causes, recommended actions. Do not fabricate data — state clearly when information is unavailable.` },
      { role: 'user', content: `Alert: ${alertTitle}\nDescription: ${alertDescription}\nEntities identified: ${entities.join(', ')}` },
    ], [], { model: this.mainModelId, maxTokens: 500, temperature: 0 })

    return {
      hypothesis: hypothesisResult.content,
      timeline: [{
        time: new Date(),
        source: 'alert',
        event: `${alertTitle}: ${alertDescription}`,
      }],
      relatedDeploys: [],
      relatedPRs: [],
      suggestedRunbook: [
        'Check service health metrics',
        'Review recent deploys',
        'Examine error logs',
        'Verify dependencies',
      ],
    }
  }
}
