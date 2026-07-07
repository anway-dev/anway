/**
 * Real, non-mocked eval CLI. Run with:
 *   DEEPSEEK_API_KEY=... npx tsx src/evals/cli.ts
 * (or ANTHROPIC_API_KEY / OPENAI_API_KEY — picks the first one set)
 *
 * Exercises each agent action against a real model, then scores the real
 * output via a separate LLM-as-judge call against a specific rubric. Exits
 * non-zero if any case falls below the pass threshold, so this is CI-usable
 * once a model key is provisioned in that environment.
 */
import { AnthropicProvider } from '../providers/anthropic.js'
import { OpenAIProvider } from '../providers/openai.js'
import type { IModelProvider } from '../interfaces/provider.js'
import type { IKnowledgeGraph } from '../interfaces/knowledge-graph.js'
import { runEvals, summarize } from './run.js'

interface NamedProvider { name: string; provider: IModelProvider }

/** Every configured provider, in priority order — used to pick the primary
 * (index 0) and, separately, an independent judge (see resolveJudgeProvider). */
function resolveAllProviders(): NamedProvider[] {
  const providers: NamedProvider[] = []
  if (process.env['DEEPSEEK_API_KEY']) {
    providers.push({ name: 'deepseek', provider: new OpenAIProvider({ type: 'deepseek', apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', cheapModel: 'deepseek-chat' }) })
  }
  if (process.env['ANTHROPIC_API_KEY']) {
    providers.push({ name: 'anthropic', provider: new AnthropicProvider({ type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] }) })
  }
  if (process.env['OPENAI_API_KEY']) {
    providers.push({ name: 'openai', provider: new OpenAIProvider({ type: 'openai', apiKey: process.env['OPENAI_API_KEY'] }) })
  }
  return providers
}

/**
 * Resolves both the primary (agent-under-test) and judge providers from a
 * *single* resolveAllProviders() call. Confirmed live via independent
 * review that calling resolveAllProviders() a second time to pick the
 * judge (as an earlier draft of this fix did) constructs brand-new
 * provider instances even for the same configured API key — a `!==`
 * object-identity check against those fresh instances is always true, so
 * with only one real provider configured it wrongly reported "using X as
 * an independent judge" while actually handing back a second, functionally
 * identical instance of the exact same model. Comparing by config `name`
 * from one shared provider list is the only way to correctly detect "is
 * there a genuinely different model available".
 */
function resolvePrimaryAndJudge(): { primary: IModelProvider; judge: IModelProvider } {
  const providers = resolveAllProviders()
  if (providers.length === 0) {
    throw new Error('No model provider configured — set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY')
  }
  const primary = providers[0]!
  const distinct = providers.find(p => p.name !== primary.name)
  if (distinct) {
    console.log(`Using ${distinct.name} as an independent judge model (agent under test: ${primary.name}).`)
    return { primary: primary.provider, judge: distinct.provider }
  }
  console.log(`Only one model provider configured (${primary.name}) — judge will use the same model as the agent under test (self-grading bias risk, see runEvals() doc comment).`)
  return { primary: primary.provider, judge: primary.provider }
}

// Evals score model output quality, not KB integration — a graph that
// gracefully reports "no context" for every lookup gives a fair cold-start
// baseline (every real agent already handles a missing/erroring graph via
// try/catch around resolveContextByName).
const noopGraph: IKnowledgeGraph = {
  resolveContextByName: async () => { throw new Error('no context in eval harness') },
  resolveContext: async () => { throw new Error('not used in eval harness') },
  upsertEntity: async () => 'noop-id',
  upsertRelationship: async () => 'noop-rel-id',
  addEpisode: async () => {},
  getFacts: async () => [],
  getEntity: async () => null,
  getRelationships: async () => [],
  search: async () => [],
  markConnectorEntitiesStale: async () => 0,
  getEntityByExternalRef: async () => null,
  deleteEntitiesByOrgPrefix: async () => 0,
}

async function main(): Promise<void> {
  const { primary: provider, judge: judgeProvider } = resolvePrimaryAndJudge()
  const results = await runEvals(provider, noopGraph, judgeProvider)
  for (const r of results) {
    console.log(`\n[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} — score ${r.score}/10`)
    console.log(`  ${r.reasoning}`)
  }
  const summary = summarize(results)
  console.log(`\n=== ${summary.passed}/${summary.total} passed, avg score ${summary.avgScore}/10 ===`)
  if (summary.passed < summary.total) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
