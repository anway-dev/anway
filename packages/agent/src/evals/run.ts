import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import type { TenantId } from '@anway/types'
import { ProductAgent } from '../agents/product.js'
import { TechSpecAgent } from '../agents/techspec.js'
import { ReviewAgent } from '../agents/review.js'
import { SREAgent } from '../agents/sre.js'
import { judge } from './judge.js'
import { productEvals, techspecEvals, reviewEvals, sreEvals } from './cases.js'
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

  return results
}

export function summarize(results: EvalResult[]): { passed: number; total: number; avgScore: number } {
  const passed = results.filter(r => r.passed).length
  const avgScore = results.reduce((s, r) => s + r.score, 0) / (results.length || 1)
  return { passed, total: results.length, avgScore: Math.round(avgScore * 10) / 10 }
}
