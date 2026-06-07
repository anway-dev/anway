import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

describe('GitHubConnector', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('list_commits calls gh api with correct URL', async () => {
    const { GitHubConnector } = await import('./connector.js')
    vi.mocked(spawnSync).mockReturnValue({
      stdout: JSON.stringify([{ sha: 'abc123', commit: { message: 'test' } }]),
      status: 0,
      stderr: '',
      error: undefined,
      pid: 0,
      output: [],
      signal: null,
    } as any)

    const c = new GitHubConnector('test-connector')
    const result = await c.read({ type: 'list_commits', repo: 'owner/repo', branch: 'main' })

    expect(spawnSync).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', expect.stringContaining('repos/owner/repo/commits')]), expect.any(Object))
    expect(result.data).toBeDefined()
  })

  it('list_commits handles empty since parameter', async () => {
    const { GitHubConnector } = await import('./connector.js')
    vi.mocked(spawnSync).mockReturnValue({
      stdout: '[]',
      status: 0,
      stderr: '',
      error: undefined,
      pid: 0,
      output: [],
      signal: null,
    } as any)

    const c = new GitHubConnector('test-connector')
    const result = await c.read({ type: 'list_commits', repo: 'owner/repo' })
    expect(spawnSync).toHaveBeenCalled()
    expect(result.data).toEqual([])
  })
})
