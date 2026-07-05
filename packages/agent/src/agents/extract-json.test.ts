import { describe, it, expect } from 'vitest'
import { extractJson } from './extract-json.js'

describe('extractJson', () => {
  it('parses plain valid JSON directly', () => {
    expect(extractJson<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
  })

  it('strips a ```json fenced block', () => {
    const raw = '```json\n{"a": 1}\n```'
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 })
  })

  it('strips a bare ``` fenced block (no language tag)', () => {
    const raw = '```\n{"a": 1}\n```'
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 })
  })

  it('extracts JSON with prose preamble and postamble', () => {
    const raw = 'Sure, here is the JSON:\n{"a": 1}\nHope that helps!'
    expect(extractJson<{ a: number }>(raw)).toEqual({ a: 1 })
  })

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('just some text, no braces here')).toThrow()
  })
})
