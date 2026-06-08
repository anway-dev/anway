import { execFile } from 'node:child_process'
import type { ExecutableTool } from '@anvay/agent'

const MAX_BUFFER = 10 * 1024 * 1024 // 10MB
const DEFAULT_TIMEOUT = 30_000

/**
 * Generic CLI adapter — wraps any CLI binary as Anvay tools.
 * Allowlist-based: only subcommands in `allowedSubcommands` are exposed.
 * Subprocess args are passed as array (no shell interpolation).
 *
 * Usage:
 *   const adapter = new CliConnector({
 *     name: 'github',
 *     binary: 'gh',
 *     allowedSubcommands: ['pr list', 'pr view'],
 *   })
 *   const tools = adapter.getTools()
 *   await adapter.call('pr list', { repo: 'org/payments' })
 */
export class CliConnector {
  private readonly toolsCache: ExecutableTool[]

  constructor(
    private readonly config: {
      name: string
      binary: string
      allowedSubcommands: string[]
      /** Environment variables to inject — never include in argv */
      env?: Record<string, string>
      timeoutMs?: number
    },
  ) {
    this.toolsCache = this.buildTools()
  }

  private buildTools(): ExecutableTool[] {
    return this.config.allowedSubcommands.map((subcommand) => {
      const parts = subcommand.split(/\s+/)
      const toolName = `${this.config.name}.${parts.join('_')}`
      return {
        name: toolName,
        description: `Execute: ${this.config.binary} ${subcommand}`,
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

          return this.execWithTimeout(argv, this.config.timeoutMs ?? DEFAULT_TIMEOUT)
        },
      }
    })
  }

  private async execWithTimeout(argv: string[], timeoutMs: number): Promise<unknown> {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(
        this.config.binary,
        argv,
        {
          env: { ...process.env, ...this.config.env },
          encoding: 'utf-8',
          maxBuffer: MAX_BUFFER,
          timeout: timeoutMs,
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`${this.config.binary} exited: ${err.message}\n${stderr}`))
            return
          }
          resolve({ stdout, stderr })
        },
      )
      // Ensure no timeout on the callback (Node built-in timeout)
      if (timeoutMs > 0) {
        setTimeout(() => {
          child.kill()
          reject(new Error(`${this.config.binary} timed out after ${timeoutMs}ms`))
        }, timeoutMs + 1000)
      }
    })

    // Try JSON parse, fall back to plain text
    let data: unknown = result.stdout
    try {
      data = JSON.parse(result.stdout)
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
  }

  /** Returns the built tools list. */
  getTools(): ExecutableTool[] {
    return this.toolsCache
  }

  /** Call a specific CLI tool by name (e.g., "pr list"). */
  async call(subcommand: string, args?: Record<string, unknown>): Promise<unknown> {
    const toolName = `${this.config.name}.${subcommand.replace(/\s+/g, '_')}`
    const tool = this.toolsCache.find((t) => t.name === toolName)
    if (!tool) throw new Error(`CLI tool "${toolName}" not found`)
    return tool.run(args ?? {})
  }

  /** Health check: binary --version */
  async health(): Promise<{ status: string; lastChecked: Date }> {
    try {
      await this.execWithTimeout(['--version'], 5000)
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', lastChecked: new Date() }
    }
  }
}
