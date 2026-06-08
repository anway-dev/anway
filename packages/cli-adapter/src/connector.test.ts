import { describe, it, expect, vi } from 'vitest'
import { CliConnector } from './connector.js'

describe('CliConnector', () => {
  it('builds tools from allowedSubcommands', async () => {
    const c = new CliConnector({
      name: 'test',
      binary: 'gh',
      allowedSubcommands: ['pr list', 'issue view'],
    })
    const tools = await c.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0]?.name).toBe('test.pr_list')
    expect(tools[1]?.name).toBe('test.issue_view')
  })

  it('calls onExec callback after subprocess', async () => {
    const onExec = vi.fn()
    const c = new CliConnector({
      name: 'test',
      binary: 'echo',
      allowedSubcommands: ['hello'],
      onExec,
    })
    await c.call('hello', { args: { world: '42' } })
    expect(onExec).toHaveBeenCalledTimes(1)
    const entry = onExec.mock.calls[0]?.[0]
    expect(entry.binary).toBe('echo')
    expect(entry.exitCode).toBe(0)
  })
})
