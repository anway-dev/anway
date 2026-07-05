import type { IModelProvider } from '../interfaces/provider.js'
import { extractJson } from '../agents/extract-json.js'
import { PASS_THRESHOLD } from './types.js'
import type { EvalResult } from './types.js'

/**
 * LLM-as-judge scoring — agent outputs are open-ended prose/JSON, not
 * exact-match-checkable. A separate model call scores the real output
 * against a specific rubric instead of brittle string assertions.
 * The judge is instructed to be skeptical and never inflate scores.
 */
export async function judge(
  judgeModel: IModelProvider,
  id: string,
  agentAction: string,
  rubric: string,
  output: unknown,
): Promise<EvalResult> {
  const result = await judgeModel.chat([
    {
      role: 'system',
      content: 'You are a strict, skeptical quality judge for an AI agent\'s output. Score 0-10 against the rubric — each rubric line is a specific, checkable claim; do not award credit for vague plausibility. Do not inflate scores. Respond ONLY with JSON matching { "score": number, "reasoning": string }.',
    },
    {
      role: 'user',
      content: `Agent action: ${agentAction}\n\nRubric (score against each line):\n${rubric}\n\nOutput to judge:\n${JSON.stringify(output, null, 2)}`,
    },
  ], [], { model: judgeModel.modelId, maxTokens: 600, temperature: 0 })

  try {
    const parsed = extractJson<{ score: number; reasoning: string }>(result.content)
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0))
    return { id, agentAction, score, passed: score >= PASS_THRESHOLD, reasoning: parsed.reasoning, rawOutput: output }
  } catch {
    return { id, agentAction, score: 0, passed: false, reasoning: `judge response unparseable: ${result.content.slice(0, 200)}`, rawOutput: output }
  }
}
