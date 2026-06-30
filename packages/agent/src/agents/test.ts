import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
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
    ], [], { model: this.cheapModel.cheapModelId, maxTokens: 50, temperature: 0 })

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate test plan in JSON matching { unitTests: [{path, description, testCases: string[]}], integrationTests: [{path, description, testCases: string[]}], e2eScenarios: string[], coverageTarget: number }. Return ONLY valid JSON.' },
      { role: 'user', content: `Title: ${spec.title}\nComponents: ${spec.components.map(c => `${c.name} (${c.technology})`).join(', ')}\nAPI: ${spec.apiChanges.map(a => `${a.method} ${a.path}`).join(', ')}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 2000, temperature: 0 })

    try { return JSON.parse(result.content) as TestPlan } catch { return { unitTests: [], integrationTests: [], e2eScenarios: [], coverageTarget: 80 } }
  }

  async writeRegressionTest(incident: string, tenantId: TenantId): Promise<TestFile> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(incident, tenantId) } catch {}

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate a regression test file in JSON matching { path: string, description: string, testCases: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Incident: ${incident}\n${graphContext ? 'Context: ' + graphContext.primaryEntity.name : ''}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1000, temperature: 0 })

    try { return JSON.parse(result.content) as TestFile } catch { return { path: 'test/regression.test.ts', description: `Regression test for: ${incident}`, testCases: [] } }
  }
}
