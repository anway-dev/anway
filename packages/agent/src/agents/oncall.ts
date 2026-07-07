import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { extractJson } from './extract-json.js'

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

    const hasRealEpisodes = !!graphContext && graphContext.recentEpisodes.length > 0

    // Confirmed live via independent review (eval harness's new chat-path
    // coverage caught this as a real, live fabrication, not just a
    // theoretical risk): the cheap-model extraction stage was always
    // called and always instructed to "summarise recent activity", even
    // when there was zero real episode data to summarize — it then
    // fabricated a plausible-sounding activity narrative out of nothing.
    // That fabricated text was passed to the main model as if it were real
    // "Activity", and the main model's own anti-hallucination instruction
    // was powerless to catch it — by the time the main model saw it, the
    // invented narrative was indistinguishable from a genuine summary of
    // real data. Skipping the extraction call entirely when there's
    // nothing real to summarize, and saying so explicitly, removes the
    // hallucination-prone middle step rather than just telling a
    // downstream stage to guess whether upstream text was invented.
    const activityText = hasRealEpisodes
      ? (await this.cheapModel.chat([
          { role: 'system', content: 'Summarise recent activity for this team — incidents, deploys, PRs. Base the summary strictly on the episodes provided; do not invent activity beyond what is given.' },
          { role: 'user', content: `Team: ${teamName}. Episodes: ${graphContext!.recentEpisodes.slice(0, 5).map(e => e.text).join(' | ')}` },
        ], [], { model: this.cheapModel.cheapModelId, maxTokens: 200, temperature: 0 })).content
      : 'No real activity data was found in the knowledge graph for this team (no recent episodes).'

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate shift brief in JSON matching { summary, openIncidents: [{title, severity, startedAt, status}], recentDeploys: string[], watchItems: string[], handoffNotes: string }. Do not fabricate incidents, deploys, or specifics not present in the provided activity — if no real incidents/deploys are available, say so explicitly in summary/handoffNotes and leave openIncidents/recentDeploys empty rather than inventing plausible-sounding ones. Return ONLY valid JSON.' },
      { role: 'user', content: `Team: ${teamName}\nActivity: ${activityText}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1500, temperature: 0 })

    // See agents/product.ts writePRD for why this throws instead of
    // returning a fabricated-looking empty stub on parse failure.
    try { return extractJson<ShiftBrief>(result.content) } catch (e) { throw new Error(`OncallAgent: failed to parse ShiftBrief JSON from model response: ${e instanceof Error ? e.message : String(e)}`) }
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
