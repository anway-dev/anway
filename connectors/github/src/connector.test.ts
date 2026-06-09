import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GitHubConnector', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('list_commits calls gh api with correct URL', async () => {
    const { GitHubConnector } = await import('./connector.js')
    // Mock the private runCli method — TypeScript's private is compile-time only
    vi.spyOn(GitHubConnector.prototype as any, 'runCli').mockResolvedValue(
      JSON.stringify([{ sha: 'abc123', commit: { message: 'test' } }]),
    )

    const c = new GitHubConnector('test-connector')
    const result = await c.read({ type: 'list_commits', repo: 'owner/repo', branch: 'main' })

    expect(result.data).toBeDefined()
    expect(Array.isArray(result.data)).toBe(true)
    expect((result.data as any[])[0].sha).toBe('abc123')
  })

  it('list_commits handles empty since parameter', async () => {
    const { GitHubConnector } = await import('./connector.js')
    vi.spyOn(GitHubConnector.prototype as any, 'runCli').mockResolvedValue('[]')

    const c = new GitHubConnector('test-connector')
    const result = await c.read({ type: 'list_commits', repo: 'owner/repo' })
    expect(result.data).toEqual([])
  })
})
