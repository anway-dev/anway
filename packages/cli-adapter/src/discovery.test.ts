import { describe, it, expect } from 'vitest'
import { parseHelpOutput } from './discovery.js'

describe('parseHelpOutput', () => {
  it('parses gh-style help output', () => {
    const text = `
Work with GitHub issues and pull requests

USAGE
  gh <command> <subcommand> [flags]

CORE COMMANDS
  pr          Manage pull requests
  issue       Manage issues
  run         View and manage workflow runs

ADDITIONAL COMMANDS
  repo        Create, clone, fork, and view repos
  auth        Login, logout, and refresh auth
`
    const cmds = parseHelpOutput(text, 'gh')
    expect(cmds.some((c) => c.name === 'pr')).toBe(true)
    expect(cmds.some((c) => c.name === 'issue')).toBe(true)
    expect(cmds.some((c) => c.name === 'run')).toBe(true)
    expect(cmds.some((c) => c.name === 'repo')).toBe(true)
    expect(cmds.some((c) => c.name === 'auth')).toBe(true)
  })

  it('skips flag lines', () => {
    const text = `
Usage: kubectl [command]

Commands:
  --help       Show help
  apply        Apply a configuration
  --kubeconfig Use a specific kubeconfig
  get          Display resources
`
    const cmds = parseHelpOutput(text, 'kubectl')
    expect(cmds.some((c) => c.name === 'apply')).toBe(true)
    expect(cmds.some((c) => c.name === 'get')).toBe(true)
    expect(cmds.some((c) => c.name.startsWith('-'))).toBe(false)
  })

  it('returns empty for unknown format', () => {
    const cmds = parseHelpOutput('no structure here', 'test-binary')
    expect(cmds).toHaveLength(0)
  })
})
