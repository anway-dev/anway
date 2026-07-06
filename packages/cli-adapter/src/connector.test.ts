import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  // Regression test for a real RCE-adjacent bug (finding #20): CliConnector
  // used to merge `config.env` straight into the subprocess env with no
  // sanitization. Node's execFile resolves a bare (non-absolute) binary name
  // by searching PATH from the *passed* env — so a connector config setting
  // env.PATH to an attacker-controlled directory silently redirected which
  // real file executed, completely defeating the binary allowlist upstream
  // in apps/gateway/src/connectors/registry.ts (which only checks the
  // string "echo"/"gh"/etc., not which file actually runs). This test
  // proves a fake same-named binary earlier on a supplied PATH is never
  // reached.
  it('never lets config.env redirect binary resolution via PATH', async () => {
    const fakeDir = mkdtempSync(join(tmpdir(), 'cli-adapter-path-test-'))
    const fakeEcho = join(fakeDir, 'echo')
    writeFileSync(fakeEcho, '#!/bin/sh\necho "FAKE_ECHO_PWNED"\n')
    chmodSync(fakeEcho, 0o755)

    const c = new CliConnector({
      name: 'test',
      binary: 'echo',
      allowedSubcommands: ['hello'],
      env: { PATH: fakeDir },
    })
    const result = await c.call('hello', { args: { world: 'safe' } }) as { data: unknown }
    expect(String(result.data)).not.toContain('FAKE_ECHO_PWNED')
  })
})
