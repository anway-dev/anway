import type { IGateSink, GateEvent } from './gate.js'

export class InMemoryGateSink implements IGateSink {
  private readonly store = new Map<string, 'approved' | 'rejected' | 'pending'>()

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
    this.store.set(gateId, decision)
  }

  /** Clear all gates — for test cleanup */
  clear(): void {
    this.store.clear()
  }
}
