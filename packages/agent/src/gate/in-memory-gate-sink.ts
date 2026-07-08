import type { IGateSink, GateEvent } from './gate.js'

export class InMemoryGateSink implements IGateSink {
  private readonly store = new Map<string, 'approved' | 'rejected' | 'pending' | 'consumed'>()

  async push(event: GateEvent): Promise<string> {
    this.store.set(event.id, 'pending')
    return event.id
  }

  async poll(gateId: string): Promise<'approved' | 'rejected' | null> {
    const status = this.store.get(gateId)
    if (status === 'pending') return null
    if (status === 'approved' || status === 'rejected') return status
    return null
  }

  async record(gateId: string, decision: 'approved' | 'rejected', _userId: string): Promise<void> {
    // Only record a decision for a gate that was genuinely push()ed first —
    // confirmed live via independent review: this previously set *any*
    // gateId key unconditionally, so a caller could "approve" a gate that
    // never existed at all. The one real caller (gate-decide-route.ts)
    // already guards this itself (a real gate_events row must exist
    // before calling record), but this class is exported and reusable —
    // the guard belongs here too, not only in one caller.
    if (!this.store.has(gateId)) return
    this.store.set(gateId, decision)
  }

  async consume(gateId: string): Promise<boolean> {
    if (this.store.get(gateId) !== 'approved') return false
    this.store.set(gateId, 'consumed')
    return true
  }

  /** Clear all gates — for test cleanup */
  clear(): void {
    this.store.clear()
  }
}
