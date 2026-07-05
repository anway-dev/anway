export interface EvalCase<TInput = unknown> {
  id: string
  agentAction: string
  input: TInput
  /** Criteria the LLM judge scores the output against — specific, checkable claims, not vibes. */
  rubric: string
}

export interface EvalResult {
  id: string
  agentAction: string
  score: number
  passed: boolean
  reasoning: string
  rawOutput: unknown
}

export const PASS_THRESHOLD = 6
