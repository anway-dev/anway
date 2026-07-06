import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph, AgentContext } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import type { TechSpec } from './techspec.js'
import { extractJson } from './extract-json.js'

export interface TestFile { path: string; description: string; testCases: string[] }
export interface TestPlan { unitTests: TestFile[]; integrationTests: TestFile[]; e2eScenarios: string[]; coverageTarget: number }

export class TestAgent {
  constructor(
    private cheapModel: IModelProvider,
    private mainModel: IModelProvider,
    private kg: IKnowledgeGraph,
  ) {}

  async writeTestPlan(spec: TechSpec, tenantId: TenantId): Promise<TestPlan> {
    // The previous cheap-model classification call here was awaited but its
    // result was never used for anything (not fed into the main prompt, not
    // returned) — burning real tokens on every call for no effect. Removed.
    // graphContext resolution was likewise dead — resolved, never read.
    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate test plan in JSON matching { unitTests: [{path, description, testCases: string[]}], integrationTests: [{path, description, testCases: string[]}], e2eScenarios: string[], coverageTarget: number }. Return ONLY valid JSON.' },
      { role: 'user', content: `Title: ${spec.title}\nComponents: ${spec.components.map(c => `${c.name} (${c.technology})`).join(', ')}\nAPI: ${spec.apiChanges.map(a => `${a.method} ${a.path}`).join(', ')}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 2000, temperature: 0 })

    // See product.ts writePRD for why this throws instead of returning a
    // fabricated-looking empty stub on parse failure.
    try { return extractJson<TestPlan>(result.content) } catch (e) { throw new Error(`TestAgent: failed to parse TestPlan JSON from model response: ${e instanceof Error ? e.message : String(e)}`) }
  }

  async writeRegressionTest(incident: string, tenantId: TenantId): Promise<TestFile> {
    let graphContext: AgentContext | null = null
    try { graphContext = await this.kg.resolveContextByName(incident, tenantId) } catch {}

    const result = await this.mainModel.chat([
      { role: 'system', content: 'Generate a regression test file in JSON matching { path: string, description: string, testCases: string[] }. Return ONLY valid JSON.' },
      { role: 'user', content: `Incident: ${incident}\n${graphContext ? 'Context: ' + graphContext.primaryEntity.name : ''}` },
    ], [], { model: this.mainModel.modelId, maxTokens: 1000, temperature: 0 })

    // See product.ts writePRD for why this throws instead of returning a
    // fabricated-looking empty stub on parse failure.
    try { return extractJson<TestFile>(result.content) } catch (e) { throw new Error(`TestAgent: failed to parse regression TestFile JSON from model response: ${e instanceof Error ? e.message : String(e)}`) }
  }
}
