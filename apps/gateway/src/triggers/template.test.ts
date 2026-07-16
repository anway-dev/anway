import { describe, it, expect } from 'vitest'
import { resolveTemplates } from './template.js'

describe('resolveTemplates', () => {
  const ctx = { incidentId: 'inc-1', serviceHint: 'cart-service', count: 3, nested: { sha: 'abc123' } }

  it('resolves a whole-string placeholder to the raw typed value', () => {
    expect(resolveTemplates('{{ payload.incidentId }}', ctx)).toBe('inc-1')
    expect(resolveTemplates('{{ count }}', ctx)).toBe(3) // number preserved, not "3"
  })

  it('supports the payload. prefix and bare keys equivalently', () => {
    expect(resolveTemplates('{{ payload.serviceHint }}', ctx)).toBe('cart-service')
    expect(resolveTemplates('{{ serviceHint }}', ctx)).toBe('cart-service')
  })

  it('interpolates mixed strings to text', () => {
    expect(resolveTemplates('auto: {{ serviceHint }} down', ctx)).toBe('auto: cart-service down')
  })

  it('walks nested objects and arrays', () => {
    const out = resolveTemplates(
      { url: 'https://x/{{ incidentId }}', body: { svc: '{{ serviceHint }}', tags: ['{{ nested.sha }}'] } },
      ctx,
    )
    expect(out).toEqual({ url: 'https://x/inc-1', body: { svc: 'cart-service', tags: ['abc123'] } })
  })

  it('renders unresolved placeholders as empty string, never leaks {{ }}', () => {
    expect(resolveTemplates('x={{ missing }}', ctx)).toBe('x=')
    expect(resolveTemplates('{{ missing }}', ctx)).toBeUndefined()
  })

  it('leaves non-string scalars untouched', () => {
    expect(resolveTemplates(42, ctx)).toBe(42)
    expect(resolveTemplates(true, ctx)).toBe(true)
    expect(resolveTemplates(null, ctx)).toBeNull()
  })
})
