import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { ProductAgent } from '../agents/product.js'
import { TechSpecAgent } from '../agents/techspec.js'
import { ReviewAgent } from '../agents/review.js'
import { SREAgent } from '../agents/sre.js'
import { BootstrapAgent } from '../agents/bootstrap.js'
import { TestAgent } from '../agents/test.js'
import { DeployAgent } from '../agents/deploy.js'
import { OncallAgent } from '../agents/oncall.js'
import { BAAgent } from '../agents/ba.js'
import { judge } from './judge.js'
import { productEvals, techspecEvals, reviewEvals, sreEvals, bootstrapEvals, testEvals, deployEvals, oncallEvals, baEvals } from './cases.js'
import type { EvalResult } from './types.js'

const TENANT = '00000000-0000-0000-0000-000000000001' as TenantId

/**
 * Runs the eval suite for agent output quality. Each agent action is
 * exercised against a real model (caller-supplied provider — this is
 * intentionally not mocked, since eval scores against a mocked/canned
 * response would be meaningless), then a separate LLM-as-judge call scores
 * the real output against a specific, checkable rubric.
 */
export async function runEvals(model: IModelProvider, kg: IKnowledgeGraph): Promise<EvalResult[]> {
  const results: EvalResult[] = []

  const product = new ProductAgent(model, model, kg)
  for (const c of productEvals) {
    const prd = await product.writePRD(c.input, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, prd))
  }

  const techspec = new TechSpecAgent(model, model, kg)
  for (const c of techspecEvals) {
    const prd = { title: c.input.prdTitle, problem: '', goals: c.input.prdGoals, nonGoals: [], userStories: [], successMetrics: [], openQuestions: [] }
    const spec = await techspec.writeTechSpec(prd, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, spec))
  }

  const review = new ReviewAgent(model, model, kg)
  for (const c of reviewEvals) {
    const findings = await review.review(c.input.diffSummary, c.input.prTitle, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, findings))
  }

  const sre = new SREAgent(model, model, kg)
  for (const c of sreEvals) {
    const ctx = await sre.assembleContext(c.input.alertTitle, c.input.alertDescription, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, { hypothesis: ctx.hypothesis }))
  }

  const bootstrap = new BootstrapAgent(model, model, kg)
  for (const c of bootstrapEvals) {
    const spec = { title: c.input.title, overview: '', architecture: c.input.architecture, components: c.input.components.map(name => ({ name, responsibility: '', technology: '' })), dataModel: '', apiChanges: [], securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' as const }
    const plan = await bootstrap.planBootstrap(spec, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, plan))
  }

  const testAgent = new TestAgent(model, model, kg)
  for (const c of testEvals) {
    const spec = { title: c.input.title, overview: '', architecture: '', components: c.input.components.map(comp => ({ ...comp, responsibility: '' })), dataModel: '', apiChanges: c.input.apiChanges.map(a => ({ ...a, description: '', breaking: false })), securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' as const }
    const testPlan = await testAgent.writeTestPlan(spec, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, testPlan))
  }

  const deploy = new DeployAgent(model, model, kg)
  for (const c of deployEvals) {
    const plan = await deploy.planDeploy(c.input.service, c.input.env, c.input.sha, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, plan))
  }

  const oncall = new OncallAgent(model, model, kg)
  for (const c of oncallEvals) {
    const brief = await oncall.generateShiftBrief(c.input, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, brief))
  }

  const ba = new BAAgent(model, model, kg)
  for (const c of baEvals) {
    const report = await ba.analyze(c.input, TENANT)
    results.push(await judge(model, c.id, c.agentAction, c.rubric, report))
  }

  return results
}

export function summarize(results: EvalResult[]): { passed: number; total: number; avgScore: number } {
  const passed = results.filter(r => r.passed).length
  const avgScore = results.reduce((s, r) => s + r.score, 0) / (results.length || 1)
  return { passed, total: results.length, avgScore: Math.round(avgScore * 10) / 10 }
}
