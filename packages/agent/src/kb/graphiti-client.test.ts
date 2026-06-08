import { describe, it, expect, vi } from 'vitest'
import { GraphitiClient } from './graphiti-client.js'

describe('GraphitiClient', () => {
  const mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)

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
})
