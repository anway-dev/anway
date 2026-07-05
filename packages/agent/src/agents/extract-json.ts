/**
 * Small local models routinely wrap "return only JSON" output in markdown
 * code fences or prose preamble/postamble. Strip that before parsing instead
 * of falling back to an empty stub on the first non-strict response.
 */
export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]!.trim() : raw.trim()
  try {
    return JSON.parse(candidate) as T
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object found in model output')
    return JSON.parse(candidate.slice(start, end + 1)) as T
  }
}
