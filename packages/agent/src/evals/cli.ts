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

function resolveProvider(): IModelProvider {
  if (process.env['DEEPSEEK_API_KEY']) {
    return new OpenAIProvider({ type: 'deepseek', apiKey: process.env['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', cheapModel: 'deepseek-chat' })
  }
  if (process.env['ANTHROPIC_API_KEY']) {
    return new AnthropicProvider({ type: 'anthropic', apiKey: process.env['ANTHROPIC_API_KEY'] })
  }
  if (process.env['OPENAI_API_KEY']) {
    return new OpenAIProvider({ type: 'openai', apiKey: process.env['OPENAI_API_KEY'] })
  }
  throw new Error('No model provider configured — set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY')
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
  const provider = resolveProvider()
  const results = await runEvals(provider, noopGraph)
  for (const r of results) {
    console.log(`\n[${r.passed ? 'PASS' : 'FAIL'}] ${r.id} — score ${r.score}/10`)
    console.log(`  ${r.reasoning}`)
  }
  const summary = summarize(results)
  console.log(`\n=== ${summary.passed}/${summary.total} passed, avg score ${summary.avgScore}/10 ===`)
  if (summary.passed < summary.total) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
