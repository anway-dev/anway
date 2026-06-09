#!/bin/bash
# Generate all 8 specialist agents
AGENTS_DIR="/Users/raj/workspace_code/ai-proj/restol/packages/agent/src/agents"

# product.ts
cat > "$AGENTS_DIR/product.ts" << 'PRODUCT'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface UserStory {
  persona: string
  action: string
  outcome: string
  acceptance: string[]
}

export interface PRD {
  title: string
  problem: string
  goals: string[]
  nonGoals: string[]
  userStories: UserStory[]
  successMetrics: string[]
  openQuestions: string[]
}

export class ProductAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writePRD(featureRequest: string, tenantId: TenantId): Promise<PRD> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(featureRequest, tenantId) } catch {}

    const extraction = await this.cheapModel.chat([
      { role: 'system', content: 'Extract persona, primary goal, and constraints from this feature request. Respond with comma-separated values only.' },
      { role: 'user', content: featureRequest },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 100, temperature: 0 })

    const graphBlock = graphContext
      ? `Context: ${graphContext.primaryEntity.name} (${graphContext.primaryEntity.type}). Related: ${graphContext.relatedEntities.map(e => e.name).join(', ')}`
      : ''

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Write a structured PRD in JSON matching interface { title, problem, goals: string[], nonGoals: string[], userStories: { persona, action, outcome, acceptance: string[] }[], successMetrics: string[], openQuestions: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Feature request: ${featureRequest}\nExtracted: ${extraction.content}\n${graphBlock}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as PRD } catch { return { title: featureRequest, problem: '', goals: [], nonGoals: [], userStories: [], successMetrics: [], openQuestions: [] } }
  }
}
PRODUCT

# techspec.ts
cat > "$AGENTS_DIR/techspec.ts" << 'TECHSPEC'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'
import type { PRD } from './product.js'

export interface Component { name: string; responsibility: string; technology: string }
export interface APIChange { method: string; path: string; description: string; breaking: boolean }

export interface TechSpec {
  title: string; overview: string; architecture: string; components: Component[]
  dataModel: string; apiChanges: APIChange[]; securityConsiderations: string[]
  testPlan: string; rolloutPlan: string; estimatedComplexity: 'low' | 'medium' | 'high'
}

export class TechSpecAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writeTechSpec(prd: PRD, tenantId: TenantId): Promise<TechSpec> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(prd.title, tenantId) } catch {}

    const extracted = await this.cheapModel.chat([
      { role: 'system', content: 'Extract existing service names and components from context. Respond comma-separated.' },
      { role: 'user', content: `PRD: ${prd.title}\n${graphContext ? 'Related: ' + graphContext.relatedEntities.map(e => e.name).join(', ') : ''}` },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Write a TechSpec in JSON matching { title, overview, architecture, components: [{name, responsibility, technology}], dataModel, apiChanges: [{method, path, description, breaking}], securityConsiderations: string[], testPlan, rolloutPlan, estimatedComplexity: "low"|"medium"|"high" }. Return ONLY valid JSON.' },
      { role: 'user', content: `PRD title: ${prd.title}\nGoals: ${prd.goals.join(', ')}\nExisting: ${extracted.content}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as TechSpec } catch { return { title: prd.title, overview: '', architecture: '', components: [], dataModel: '', apiChanges: [], securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' } }
  }
}
TECHSPEC

# bootstrap.ts (agent, not connector bootstrap)
cat > "$AGENTS_DIR/bootstrap.ts" << 'BOOTSTRAP'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'
import type { TechSpec } from './techspec.js'

export interface FileToCreate { path: string; description: string; template: string }
export interface BootstrapPlan { service: string; files: FileToCreate[]; commands: string[]; prDescription: string }

export class BootstrapAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async planBootstrap(spec: TechSpec, tenantId: TenantId): Promise<BootstrapPlan> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(spec.title, tenantId) } catch {}

    const langExtraction = await this.cheapModel.chat([
      { role: 'system', content: 'Identify language, framework, and stack from this context. Respond comma-separated.' },
      { role: 'user', content: `TechSpec: ${spec.title}. Architecture: ${spec.architecture}. ${graphContext ? 'Existing: ' + graphContext.relatedEntities.map(e => e.name).join(', ') : ''}` },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate a bootstrap plan in JSON matching { service: string, files: [{path, description, template}], commands: string[], prDescription: string }. Return ONLY valid JSON.' },
      { role: 'user', content: `Service: ${spec.title}\nArchitecture: ${spec.architecture}\nComponents: ${spec.components.map(c => c.name).join(', ')}\nStack: ${langExtraction.content}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as BootstrapPlan } catch { return { service: spec.title, files: [], commands: [], prDescription: '' } }
  }
}
BOOTSTRAP

# test.ts
cat > "$AGENTS_DIR/test.ts" << 'TEST'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'
import type { TechSpec } from './techspec.js'

export interface TestFile { path: string; description: string; testCases: string[] }
export interface TestPlan { unitTests: TestFile[]; integrationTests: TestFile[]; e2eScenarios: string[]; coverageTarget: number }

export class TestAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writeTestPlan(spec: TechSpec, tenantId: TenantId): Promise<TestPlan> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(spec.title, tenantId) } catch {}

    await this.cheapModel.chat([
      { role: 'system', content: 'Classify the complexity and criticality of this service.' },
      { role: 'user', content: `Spec: ${spec.title}. API changes: ${spec.apiChanges.length}. Components: ${spec.components.length}` },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 50, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate test plan in JSON matching { unitTests: [{path, description, testCases: string[]}], integrationTests: [{path, description, testCases: string[]}], e2eScenarios: string[], coverageTarget: number }. Return ONLY valid JSON.' },
      { role: 'user', content: `Title: ${spec.title}\nComponents: ${spec.components.map(c => `${c.name} (${c.technology})`).join(', ')}\nAPI: ${spec.apiChanges.map(a => `${a.method} ${a.path}`).join(', ')}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as TestPlan } catch { return { unitTests: [], integrationTests: [], e2eScenarios: [], coverageTarget: 80 } }
  }

  async writeRegressionTest(incident: string, tenantId: TenantId): Promise<TestFile> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(incident, tenantId) } catch {}

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate a regression test file in JSON matching { path: string, description: string, testCases: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Incident: ${incident}\n${graphContext ? 'Context: ' + graphContext.primaryEntity.name : ''}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1000, temperature: 0 })

    try { return JSON.parse(result.content) as TestFile } catch { return { path: 'test/regression.test.ts', description: `Regression test for: ${incident}`, testCases: [] } }
  }
}
TEST

# review.ts
cat > "$AGENTS_DIR/review.ts" << 'REVIEW'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface Finding { file: string; line?: number; severity: 'blocking' | 'high' | 'medium' | 'low'; description: string; suggestion: string }
export interface ReviewFindings { summary: string; blocking: Finding[]; nonBlocking: Finding[]; testPlan: string[]; approvalRecommendation: 'approve' | 'approve_with_changes' | 'request_changes' }

export class ReviewAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async review(diffSummary: string, prTitle: string, tenantId: TenantId): Promise<ReviewFindings> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(prTitle, tenantId) } catch {}

    const classification = await this.cheapModel.chat([
      { role: 'system', content: 'Classify this diff as security|perf|logic|style|docs. Respond single word.' },
      { role: 'user', content: diffSummary },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 10, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Review code in JSON matching { summary, blocking: [{file, line?, severity: "blocking"|"high"|"medium"|"low", description, suggestion}], nonBlocking: [...], testPlan: string[], approvalRecommendation: "approve"|"approve_with_changes"|"request_changes" }. Return ONLY valid JSON.' },
      { role: 'user', content: `PR: ${prTitle}\nDiff type: ${classification.content}\n${graphContext ? 'Context: ' + graphContext.primaryEntity.name : ''}\n\n${diffSummary}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as ReviewFindings } catch { return { summary: '', blocking: [], nonBlocking: [], testPlan: [], approvalRecommendation: 'request_changes' } }
  }
}
REVIEW

# deploy.ts
cat > "$AGENTS_DIR/deploy.ts" << 'DEPLOY'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface DeployPlan { service: string; environment: string; strategy: 'rolling' | 'blue_green' | 'canary'; preChecks: string[]; postChecks: string[]; rollbackTriggers: string[]; estimatedDuration: string; confidence: number }

export class DeployAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async planDeploy(service: string, env: string, sha: string, tenantId: TenantId): Promise<DeployPlan> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(service, tenantId) } catch {}

    const history = await this.cheapModel.chat([
      { role: 'system', content: 'Extract deploy history, recent incidents, and failure rate from context.' },
      { role: 'user', content: `Service: ${service}. ${graphContext ? 'Recent episodes: ' + graphContext.recentEpisodes.slice(0, 3).map(e => e.text).join(' | ') : 'No graph context'}` },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 100, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate deploy plan in JSON matching { service, environment, strategy: "rolling"|"blue_green"|"canary", preChecks: string[], postChecks: string[], rollbackTriggers: string[], estimatedDuration, confidence: number }. Return ONLY valid JSON.' },
      { role: 'user', content: `Service: ${service}\nEnv: ${env}\nSHA: ${sha}\nHistory: ${history.content}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1000, temperature: 0 })

    try { return JSON.parse(result.content) as DeployPlan } catch { return { service, environment: env, strategy: 'rolling', preChecks: [], postChecks: [], rollbackTriggers: [], estimatedDuration: '10m', confidence: 0.5 } }
  }
}
DEPLOY

# oncall.ts
cat > "$AGENTS_DIR/oncall.ts" << 'ONCALL'
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
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 200, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate shift brief in JSON matching { summary, openIncidents: [{title, severity, startedAt, status}], recentDeploys: string[], watchItems: string[], handoffNotes: string }. Return ONLY valid JSON.' },
      { role: 'user', content: `Team: ${teamName}\nActivity: ${extraction.content}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1500, temperature: 0 })

    try { return JSON.parse(result.content) as ShiftBrief } catch { return { summary: '', openIncidents: [], recentDeploys: [], watchItems: [], handoffNotes: '' } }
  }

  async investigateAlert(alertTitle: string, tenantId: TenantId): Promise<string> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(alertTitle, tenantId) } catch {}

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Investigate this alert. What changed before it fired? Analyse timeline and suggest next steps.' },
      { role: 'user', content: `Alert: ${alertTitle}\n${graphContext ? 'Context: ' + JSON.stringify(graphContext) : 'No context'}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1000, temperature: 0 })

    return result.content
  }
}
ONCALL

# ba.ts
cat > "$AGENTS_DIR/ba.ts" << 'BA'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anvay/types'

export interface MetricPoint { label: string; value: string | number; trend?: 'up' | 'down' | 'stable' }
export interface AnalysisReport { query: string; summary: string; metrics: MetricPoint[]; insights: string[]; recommendations: string[] }

export class BAAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async analyze(query: string, tenantId: TenantId): Promise<AnalysisReport> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(query, tenantId) } catch {}

    const classification = await this.cheapModel.chat([
      { role: 'system', content: 'Classify this business query as: adoption|revenue|performance|usage|custom. Respond single word.' },
      { role: 'user', content: query },
    ], [], { model: 'claude-haiku-3-5-20251001', maxTokens: 10, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Answer business query in JSON matching { query, summary, metrics: [{label, value, trend?: "up"|"down"|"stable"}], insights: string[], recommendations: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Query: ${query}\nType: ${classification.content}\n${graphContext ? 'Context: ' + JSON.stringify(graphContext) : ''}` },
    ], [], { model: 'claude-sonnet-4-6', maxTokens: 1500, temperature: 0 })

    try { return JSON.parse(result.content) as AnalysisReport } catch { return { query, summary: '', metrics: [], insights: [], recommendations: [] } }
  }
}
BA

echo "All 8 specialist agents created."