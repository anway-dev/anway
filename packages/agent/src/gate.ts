export interface GateConfig {
  condition: string
  approvers: string[]
  /** 0.0–1.0. Confidence at or above this threshold triggers auto-approval. */
  autoApproveThreshold: number
}

export type GateDecision =
  | { readonly approved: true; readonly by: 'auto' | string }
  | { readonly approved: false; readonly reason: string }

export interface Gate {
  /**
   * Evaluates whether the action passes the gate given the model's confidence score.
   *
   * V1 semantics:
   *   - confidence >= autoApproveThreshold → auto-approved
   *   - otherwise → pending human confirmation (returns approved: false with reason)
   *
   * Full suspend-resume (L3/L4 autonomy) is implemented in M6.
   */
  evaluate(confidence: number): Promise<GateDecision>
}

/**
 * Creates a gate that auto-approves when confidence meets the threshold,
 * and defers to human approval otherwise.
 *
 * In V1 the gate does not actually suspend execution — it returns immediately
 * with approved: false so the caller can surface the gate_required StreamEvent
 * and wait for the user's explicit confirm click.
 */
export function createGate(config: GateConfig): Gate {
  return {
    async evaluate(confidence: number): Promise<GateDecision> {
      if (confidence >= config.autoApproveThreshold) {
        return { approved: true, by: 'auto' }
      }
      return {
        approved: false,
        reason: `Confidence ${confidence.toFixed(2)} is below auto-approve threshold ${config.autoApproveThreshold.toFixed(2)}. Requires approval from: ${config.approvers.join(', ') || 'any approver'}.`,
      }
    },
  }
}
