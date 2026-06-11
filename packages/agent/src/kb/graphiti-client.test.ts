import { describe, it, expect, vi } from 'vitest'
import { GraphitiClient } from './graphiti-client.js'

describe('GraphitiClient', () => {
  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)
  beforeEach(() => mockFetch.mockClear())

  it('addEpisode posts to /episodes with X-Tenant-Id header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}), text: async () => '' })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })

    await client.addEpisode({
      text: 'test episode',
      source: 'test',
      timestamp: new Date('2026-01-01'),
    })

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/episodes', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 't-1' },
      body: expect.stringContaining('test episode'),
    }))
  })

  it('getFacts calls GET /facts with query param', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ([]), text: async () => '' })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })

    await client.getFacts('payments-api')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:8000/facts?query=payments-api'),
      expect.objectContaining({ headers: { 'X-Tenant-Id': 't-1' } }),
    )
  })

  it('retries up to 3 attempts on 5xx then returns []', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })
    const result = await client.getFacts('test-query')
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 4xx — returns [] after 1 attempt', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })
    const result = await client.getFacts('test-query')
    expect(result).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns facts on first successful attempt', async () => {
    const facts = [{ claim: 'test', source: 's', validFrom: new Date(), validTo: new Date(), confidence: 1.0 }]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => facts })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })
    const result = await client.getFacts('test')
    expect(result).toEqual(facts)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries once on 5xx then succeeds', async () => {
    const facts = [{ claim: 'ok', source: 's', validFrom: new Date(), validTo: new Date(), confidence: 1.0 }]
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => facts })
    const client = new GraphitiClient({ baseUrl: 'http://localhost:8000', tenantId: 't-1' })
    const result = await client.getFacts('test')
    expect(result).toEqual(facts)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
