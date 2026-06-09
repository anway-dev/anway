import { execFile } from 'node:child_process'

export interface DiscoveredCommand {
  name: string
  description: string
}

/**
 * Runs `binary --help` and parses subcommand names/descriptions from stdout.
 * Best-effort — never throws. Returns [] on unknown format or failure.
 *
 * Strategy:
 * - Split stdout lines
 * - Match lines starting with 2+ spaces followed by a word (common CLI help format)
 * - Extract: `  subcommand   description` → `{ name: 'subcommand', description: '...' }`
 * - Skip flag lines (`--foo`, `-f`)
 * - For each top-level subcommand, optionally recurse 1 level for nested commands
 */
export async function discoverSubcommands(
  binary: string,
  env?: Record<string, string>,
  timeoutMs = 10_000,
): Promise<DiscoveredCommand[]> {
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(binary, ['--help'], { env: { ...process.env, ...env }, encoding: 'utf-8', timeout: timeoutMs }, (err, stdout) => {
        if (err) {
          // Try without --help flag for some CLIs
          reject(err)
          return
        }
        resolve({ stdout })
      })
    })

    return parseHelpOutput(stdout, binary, env, timeoutMs)
  } catch {
    return []
  }
}

/**
 * Parse help text and extract subcommands.
 * Exported for testing.
 */
export function parseHelpOutput(
  text: string,
  binary: string,
  _env?: Record<string, string>,
  _timeoutMs?: number,
): DiscoveredCommand[] {
  const lines = text.split('\n')
  const topLevel: DiscoveredCommand[] = []

  for (const line of lines) {
    // Match lines with 2+ leading spaces, then a word, then more spaces, then text
    const trimmed = line.replace(/\s+$/, '')
    const match = trimmed.match(/^(\s{2,})(\S+.*?)(\s{2,}(.*?))?$/)
    if (!match) continue

    const name = match[2]?.trim()
    const description = match[4]?.trim() ?? ''

    // Skip flags
    if (!name || name.startsWith('-')) continue
    // Skip lines that are just the binary name itself
    if (name === binary) continue
    // Skip lines that contain more than one word with special chars (rare)
    if (/\s/.test(name) && /[^a-z0-9._\-\s]/i.test(name)) continue

    topLevel.push({ name, description })
  }

  return topLevel
}
