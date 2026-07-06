import { execFile } from 'node:child_process'
import type { ExecutableTool } from '@anway/agent'
import { discoverSubcommands } from './discovery.js'
import type { DiscoveredCommand } from './discovery.js'
import { sanitizeCliEnv } from './env-guard.js'

export type { DiscoveredCommand }
export { discoverSubcommands }

const MAX_BUFFER = 10 * 1024 * 1024 // 10MB
const DEFAULT_TIMEOUT = 30_000

export interface CliExecEntry {
  binary: string
  argv: string[]
  durationMs: number
  exitCode: number | null
}

/**
 * Generic CLI adapter — wraps any CLI binary as Anway tools.
 * Allowlist-based: only subcommands in `allowedSubcommands` are exposed.
 * If `allowedSubcommands` is omitted, auto-discovers from `binary --help`.
 *
 * Subprocess args are passed as array (no shell interpolation).
 *
 * Usage:
 *   const adapter = new CliConnector({ name: 'github', binary: 'gh' })
 *   const tools = await adapter.getTools()   // auto-discovery
 *   await adapter.call('pr list', { repo: 'org/payments' })
 *
 *   // Curated mode:
 *   const curated = new CliConnector({
 *     name: 'github', binary: 'gh',
 *     allowedSubcommands: ['pr list', 'pr view'],
 *   })
 */
export class CliConnector {
  private toolsCache: ExecutableTool[] | null = null

  constructor(
    private readonly config: {
      name: string
      binary: string
      allowedSubcommands?: string[]
      /** Environment variables to inject — never include in argv */
      env?: Record<string, string>
      timeoutMs?: number
      /** Called after each subprocess completes. Wire to auditSink.append(). */
      onExec?: (entry: CliExecEntry) => void
    },
  ) {
    if (this.config.allowedSubcommands) {
      this.toolsCache = this.buildTools(this.config.allowedSubcommands)
    }
  }

  private buildTools(subcommands: string[]): ExecutableTool[] {
    const cfg = this.config
    return subcommands.map((subcommand) => {
      const parts = subcommand.split(/\s+/)
      const toolName = `${cfg.name}.${parts.join('_')}`
      return {
        name: toolName,
        description: `Execute: ${cfg.binary} ${subcommand}`,
        parameters: {
          type: 'object',
          properties: {
            args: { type: 'object', description: 'CLI argument key-value pairs to append' },
          },
        },
        run: async (runArgs: Record<string, unknown>) => {
          const argv = [...parts]

          // Flatten positional args and key-value pairs
          if (runArgs['args'] && typeof runArgs['args'] === 'object') {
            const kvArgs = runArgs['args'] as Record<string, unknown>
            for (const [k, v] of Object.entries(kvArgs)) {
              argv.push(`--${k}`, String(v))
            }
          }

          return this.execWithTimeout(argv, cfg.timeoutMs ?? DEFAULT_TIMEOUT)
        },
      }
    })
  }

  /**
   * Auto-discover subcommands from `binary --help` and build tools.
   * Used when `allowedSubcommands` was not provided in config.
   */
  async discoverAndBuild(): Promise<ExecutableTool[]> {
    if (this.toolsCache) return this.toolsCache
    const cmds = await discoverSubcommands(this.config.binary, sanitizeCliEnv(this.config.env), this.config.timeoutMs)
    this.toolsCache = this.buildTools(cmds.map((c) => c.name))
    return this.toolsCache
  }

  private async execWithTimeout(argv: string[], timeoutMs: number): Promise<unknown> {
    const startTime = Date.now()

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          this.config.binary,
          argv,
          {
            env: { ...process.env, ...sanitizeCliEnv(this.config.env) },
            encoding: 'utf-8',
            maxBuffer: MAX_BUFFER,
            timeout: timeoutMs,
            killSignal: 'SIGTERM',
          },
          (err, stdout, stderr) => {
            if (err) {
              reject(new Error(`${this.config.binary} exited: ${err.message}\n${stderr}`))
              return
            }
            resolve({ stdout, stderr })
          },
        )
      })

      const durationMs = Date.now() - startTime

      // Audit callback
      this.config.onExec?.({
        binary: this.config.binary,
        argv,
        durationMs,
        exitCode: 0,
      })

      // Try JSON parse, fall back to plain text
      let data: unknown = stdout
      try {
        data = JSON.parse(stdout)
      } catch {
        // Not JSON — return as text
      }

      return {
        source: `cli:${this.config.name}`,
        fetched_at: new Date(),
        ttl: 120,
        freshness_score: 1.0,
        data,
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      this.config.onExec?.({
        binary: this.config.binary,
        argv,
        durationMs,
        exitCode: 1,
      })
      throw err
    }
  }

  /**
   * Returns the tools list.
   * If `allowedSubcommands` was provided in config, returns cached list synchronously.
   * Otherwise runs discovery via `binary --help` and builds tools.
   */
  async getTools(): Promise<ExecutableTool[]> {
    if (this.toolsCache) return this.toolsCache
    return this.discoverAndBuild()
  }

  /** Call a specific CLI tool by name (e.g., "pr list"). */
  async call(subcommand: string, args?: Record<string, unknown>): Promise<unknown> {
    const tools = await this.getTools()
    const toolName = `${this.config.name}.${subcommand.replace(/\s+/g, '_')}`
    const tool = tools.find((t) => t.name === toolName)
    if (!tool) throw new Error(`CLI tool "${toolName}" not found`)
    return tool.run(args ?? {})
  }

  /**
   * Health check: runs `binary --version` by default. Not every CLI
   * supports that flag (confirmed live: `kubectl --version` exits 1 with
   * "unknown flag" — kubectl uses the `version` subcommand instead), so
   * callers wrapping such a binary should pass `versionArgs` to override.
   */
  async health(versionArgs: string[] = ['--version']): Promise<{ status: string; lastChecked: Date }> {
    try {
      await this.execWithTimeout(versionArgs, 5000)
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', lastChecked: new Date() }
    }
  }
}
