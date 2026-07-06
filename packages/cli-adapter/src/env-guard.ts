/**
 * Env vars that must never be overridable by connector config, no matter how
 * trusted the caller (admin-only, gate-approved) — confirmed live via
 * independent review that CliConnector merged `{ ...process.env, ...config.env }`
 * verbatim into the subprocess env. Node's execFile resolves a non-absolute
 * `binary` (e.g. "gh") by searching `PATH` from the *passed* env, not
 * process.env — so an admin registering a connector with
 * `binary: "gh", env: { PATH: "/tmp/evil" }` causes the real invocation to
 * run `/tmp/evil/gh` instead of the real one, silently defeating
 * ALLOWED_CLI_BINARIES entirely (the allowlist checks the string "gh", not
 * which file actually executes). Beyond PATH, several other env vars let a
 * dynamically-linked or shell-invoking CLI load/execute arbitrary code
 * regardless of which binary was allowlisted (LD_PRELOAD, GIT_SSH_COMMAND,
 * NODE_OPTIONS, etc.) — all stripped for the same reason.
 */
const FORBIDDEN_ENV_KEYS = new Set([
  'PATH',
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS', 'NODE_PATH',
  'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH', 'GIT_ASKPASS',
  'BASH_ENV', 'ENV', 'IFS', 'SHELL', 'PS4',
  'PYTHONPATH', 'PYTHONSTARTUP', 'PERL5LIB', 'RUBYOPT',
])

/**
 * Sanitize a connector-config-supplied env map before merging it into a
 * subprocess environment. Drops any key that could redirect binary
 * resolution or inject code loading into the child process. `process.env`
 * always wins for these keys — the caller-supplied value is discarded
 * outright rather than merged, so there's no way to partially override
 * (e.g. appending to PATH).
 */
export function sanitizeCliEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {}
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (FORBIDDEN_ENV_KEYS.has(k.toUpperCase())) continue
    clean[k] = v
  }
  return clean
}
