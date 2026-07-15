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
import { GraphBuilderAgent } from '../graph-builder/builder.js'
import { ConnectorAgent } from '../agents/connector-agent.js'
import type { SpecialistContext } from '../agents/connector-agent.js'
import type { ExecutableTool } from '../orchestrator.js'
import type { AgentPerimeter } from '../perimeter/engine.js'
import type { PerimeterCtx } from '../middleware/perimeter.js'
import type { IAuditSink } from '../interfaces/audit.js'
import { classifyToolRoles } from '../connectors/tool-role-classifier.js'
import { judge } from './judge.js'
import { runChatEval } from './chat-eval.js'
import { productEvals, techspecEvals, reviewEvals, sreEvals, bootstrapEvals, testEvals, deployEvals, oncallEvals, baEvals, chatEvals, graphBuilderEvals, connectorAgentEvals, toolRoleEvals } from './cases.js'
import type { EvalResult } from './types.js'

const TENANT = '00000000-0000-0000-0000-000000000001' as TenantId

/**
 * Runs the eval suite for agent output quality. Each agent action is
 * exercised against a real model (caller-supplied provider — this is
 * intentionally not mocked, since eval scores against a mocked/canned
 * response would be meaningless), then a separate LLM-as-judge call scores
 * the real output against a specific, checkable rubric.
 *
 * `judgeModel` defaults to `model` for backward compatibility, but passing
 * a genuinely different model is strongly preferred — confirmed live via
 * independent review (finding I8) that the same model instance grading its
 * own output is a real self-grading bias risk (a model tends to be more
 * lenient toward its own phrasing/reasoning style than an independent
 * judge would be), not a true independent quality check. cli.ts picks a
 * second distinct provider for judging whenever more than one API key is
 * configured.
 */
// Agent methods now throw on a real JSON-parse failure instead of silently
// returning a fabricated-looking empty stub (see agents/product.ts etc.) —
// correct for production callers, which already try/catch this into a real
// error response, but this eval loop had no such wrapping: an uncaught
// throw here would abort every remaining case in the whole suite, not just
// the one that failed. Record a real failing EvalResult instead so one bad
// case doesn't take down the rest of the run.
export async function runEvals(model: IModelProvider, kg: IKnowledgeGraph, judgeModel: IModelProvider = model): Promise<EvalResult[]> {
  const results: EvalResult[] = []
  const run = (id: string, agentAction: string, rubric: string, produce: () => Promise<unknown>) =>
    produce().then(
      (output) => judge(judgeModel, id, agentAction, rubric, output),
      (e: unknown) => ({ id, agentAction, score: 0, passed: false, reasoning: `Agent threw before producing output: ${e instanceof Error ? e.message : String(e)}`, rawOutput: null }) satisfies EvalResult,
    )

  const product = new ProductAgent(model, model, kg)
  for (const c of productEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => product.writePRD(c.input, TENANT)))
  }

  const techspec = new TechSpecAgent(model, model, kg)
  for (const c of techspecEvals) {
    const prd = { title: c.input.prdTitle, problem: '', goals: c.input.prdGoals, nonGoals: [], userStories: [], successMetrics: [], openQuestions: [] }
    results.push(await run(c.id, c.agentAction, c.rubric, () => techspec.writeTechSpec(prd, TENANT)))
  }

  const review = new ReviewAgent(model, model, kg)
  for (const c of reviewEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => review.review(c.input.diffSummary, c.input.prTitle, TENANT)))
  }

  const sre = new SREAgent(model, model, kg)
  for (const c of sreEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, async () => {
      const ctx = await sre.assembleContext(c.input.alertTitle, c.input.alertDescription, TENANT)
      return { hypothesis: ctx.hypothesis }
    }))
  }

  const bootstrap = new BootstrapAgent(model, model, kg)
  for (const c of bootstrapEvals) {
    const spec = { title: c.input.title, overview: '', architecture: c.input.architecture, components: c.input.components.map(name => ({ name, responsibility: '', technology: '' })), dataModel: '', apiChanges: [], securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' as const }
    results.push(await run(c.id, c.agentAction, c.rubric, () => bootstrap.planBootstrap(spec, TENANT)))
  }

  const testAgent = new TestAgent(model, model, kg)
  for (const c of testEvals) {
    const spec = { title: c.input.title, overview: '', architecture: '', components: c.input.components.map(comp => ({ ...comp, responsibility: '' })), dataModel: '', apiChanges: c.input.apiChanges.map(a => ({ ...a, description: '', breaking: false })), securityConsiderations: [], testPlan: '', rolloutPlan: '', estimatedComplexity: 'medium' as const }
    results.push(await run(c.id, c.agentAction, c.rubric, () => testAgent.writeTestPlan(spec, TENANT)))
  }

  const deploy = new DeployAgent(model, model, kg)
  for (const c of deployEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => deploy.planDeploy(c.input.service, c.input.env, c.input.sha, TENANT)))
  }

  const oncall = new OncallAgent(model, model, kg)
  for (const c of oncallEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => oncall.generateShiftBrief(c.input, TENANT)))
  }

  const ba = new BAAgent(model, model, kg)
  for (const c of baEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => ba.analyze(c.input, TENANT)))
  }

  // Primary chat path (createOrchestrator + runSession) — see chatEvals'
  // doc comment in cases.ts. Uses its own runner (runChatEval), not the
  // generic `run()` helper above, since it exercises the real streaming
  // entry point rather than a single specialist-agent method call.
  for (const c of chatEvals) {
    results.push(await runChatEval(model, judgeModel, c.id, c.input, c.rubric))
  }

  // Graph Builder — cheap-model service extraction that seeds the graph.
  const graphBuilder = new GraphBuilderAgent(kg, model)
  for (const c of graphBuilderEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, async () => {
      const name = await graphBuilder.extractServiceName(c.input.text, TENANT)
      return { extractedServiceName: name }
    }))
  }

  // Connector Agent — real agent run against a canned tool. Permissive
  // perimeter + no-op audit sink: this eval scores answer QUALITY (accuracy +
  // no fabrication), not perimeter/audit behaviour, which have their own tests.
  const allowAllPerimeter = { allows: () => true } as unknown as AgentPerimeter
  const noopAudit: IAuditSink = { append: async () => {} }
  const evalPerimeterCtx = { tenantId: TENANT, userId: 'eval-user', sessionId: 'eval-session' } as unknown as PerimeterCtx
  for (const c of connectorAgentEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, async () => {
      const tools: ExecutableTool[] = [{
        name: c.input.tool.name,
        description: c.input.tool.description,
        parameters: { type: 'object', properties: {} },
        run: async () => c.input.tool.returns,
      }]
      const agent = new ConnectorAgent({
        agentType: c.input.agentType, model, tools,
        perimeter: allowAllPerimeter, auditSink: noopAudit, perimeterCtx: evalPerimeterCtx,
      })
      const ctx: SpecialistContext = {
        task: c.input.task, intent: c.input.intent, coordinates: c.input.coordinates,
        tenantId: TENANT, sessionId: 'eval-session', userId: 'eval-user',
      }
      const finding = await agent.run(ctx)
      return { summary: finding.summary, confidence: finding.confidence, toolsUsed: finding.toolsUsed }
    }))
  }

  // Tool-role classifier — cheap-model read/write labelling that gates writes.
  for (const c of toolRoleEvals) {
    results.push(await run(c.id, c.agentAction, c.rubric, () => classifyToolRoles(model, c.input.tools)))
  }

  return results
}

export function summarize(results: EvalResult[]): { passed: number; total: number; avgScore: number } {
  const passed = results.filter(r => r.passed).length
  const avgScore = results.reduce((s, r) => s + r.score, 0) / (results.length || 1)
  return { passed, total: results.length, avgScore: Math.round(avgScore * 10) / 10 }
}
