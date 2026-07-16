// Template resolution for generic trigger-action params.
//
// Action params can reference the triggering event's payload with {{ }}:
//   { "incidentId": "{{ payload.incidentId }}", "note": "auto: {{ payload.service }} down" }
//
// This is what makes generic actions useful — "resolve THIS incident" needs the
// id from THIS event. `payload.` is optional; {{ incidentId }} works too.
//
// Value semantics: if a string is EXACTLY one placeholder, the raw typed value
// is returned (number/bool/object preserved). Mixed strings interpolate to text.
// Unresolved placeholders render as empty string (never leak "{{ }}" downstream).

const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/
const INLINE = /\{\{\s*([^}]+?)\s*\}\}/g

function lookup(expr: string, ctx: Record<string, unknown>): unknown {
  const path = expr.trim().replace(/^payload\./, '').split('.')
  let cur: unknown = ctx
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function renderString(s: string, ctx: Record<string, unknown>): unknown {
  const whole = s.match(WHOLE)
  if (whole) return lookup(whole[1]!, ctx)
  return s.replace(INLINE, (_m, expr: string) => {
    const v = lookup(expr, ctx)
    return v == null ? '' : String(v)
  })
}

/** Deep-resolve every {{ }} placeholder in `value` against the event `ctx`. */
export function resolveTemplates<T>(value: T, ctx: Record<string, unknown>): T {
  if (typeof value === 'string') return renderString(value, ctx) as unknown as T
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, ctx)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, ctx)
    return out as unknown as T
  }
  return value
}
