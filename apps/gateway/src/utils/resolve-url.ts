import { existsSync } from 'node:fs'

const IN_DOCKER = existsSync('/.dockerenv')

/**
 * When the gateway runs inside Docker, user-supplied URLs like http://localhost:9090
 * point to the container itself, not the host. Rewrite them so they reach the host.
 * No-op outside Docker so local dev (gateway on host) is unaffected.
 */
export function resolveConnectorUrl(url: string): string {
  if (!IN_DOCKER) return url
  return url.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)/, '$1host.docker.internal')
}
