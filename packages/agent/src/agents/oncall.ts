import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface IncidentSummary { title: string; severity: string; startedAt: string; status: string }
export interface ShiftBrief { summary: string; openIncidents: IncidentSummary[]; recentDeploys: string[]; watchItems: string[]; handoffNotes: string }

export class OncallAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async generateShiftBrief(teamName: string, tenantId: TenantId): Promise<ShiftBrief> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(teamName, tenantId) } catch {}

    const extraction = await this.cheapModel.chat([
      { role: 'system', content: 'Summarise recent activity for this team — incidents, deploys, PRs.' },
      { role: 'user', content: `Team: ${teamName}. ${graphContext ? 'Episodes: ' + graphContext.recentEpisodes.slice(0, 5).map(e => e.text).join(' | ') : ''}` },
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 200, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate shift brief in JSON matching { summary, openIncidents: [{title, severity, startedAt, status}], recentDeploys: string[], watchItems: string[], handoffNotes: string }. Return ONLY valid JSON.' },
      { role: 'user', content: `Team: ${teamName}\nActivity: ${extraction.content}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1500, temperature: 0 })

    try { return JSON.parse(result.content) as ShiftBrief } catch { return { summary: '', openIncidents: [], recentDeploys: [], watchItems: [], handoffNotes: '' } }
  }

  async investigateAlert(alertTitle: string, tenantId: TenantId): Promise<string> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(alertTitle, tenantId) } catch {}

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Investigate this alert. What changed before it fired? Analyse timeline and suggest next steps.' },
      { role: 'user', content: `Alert: ${alertTitle}\n${graphContext ? `Entity: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type}). Related: ${graphContext.relatedEntities.slice(0, 5).map(e => e.name).join(', ')}. Recent: ${graphContext.recentEpisodes.slice(0, 5).map(e => e.text).join(' | ')}` : 'No context'}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1000, temperature: 0 })

    return result.content
  }
}
