import { describe, it, expect } from 'vitest'
import { sanitizeCliEnv } from './env-guard.js'

describe('sanitizeCliEnv', () => {
  it('strips PATH so binary resolution can never be redirected', () => {
    const out = sanitizeCliEnv({ PATH: '/tmp/evil', GITHUB_TOKEN: 'abc123' })
    expect(out['PATH']).toBeUndefined()
    expect(out['GITHUB_TOKEN']).toBe('abc123')
  })

  it('strips dynamic-linker and shell-injection env vars case-insensitively', () => {
    const out = sanitizeCliEnv({
      ld_preload: '/tmp/evil.so',
      LD_LIBRARY_PATH: '/tmp',
      NODE_OPTIONS: '--require /tmp/evil.js',
      GIT_SSH_COMMAND: 'rm -rf /',
      BASH_ENV: '/tmp/evil.sh',
      SAFE_VAR: 'kept',
    })
    expect(out).toEqual({ SAFE_VAR: 'kept' })
  })

  it('returns an empty object for undefined input', () => {
    expect(sanitizeCliEnv(undefined)).toEqual({})
  })

  it('passes through legitimate connector auth env vars untouched', () => {
    const out = sanitizeCliEnv({ AWS_ACCESS_KEY_ID: 'AKIA...', AWS_DEFAULT_REGION: 'us-east-1' })
    expect(out).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA...', AWS_DEFAULT_REGION: 'us-east-1' })
  })
})
