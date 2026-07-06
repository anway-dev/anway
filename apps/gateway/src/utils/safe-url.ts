import dns from 'node:dns/promises'

/** Cheap, synchronous SSRF guard: blocks obviously-internal hosts by literal string/pattern. */
export function isSafeBaseUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (!['http:', 'https:'].includes(u.protocol)) return false
    const host = u.hostname.replace(/^\[|\]$/g, '')  // strip IPv6 brackets
    // Block RFC-1918 private ranges + loopback IPs. localhost blocked too — consistency with 127.0.0.1
    if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === 'localhost') return false
    // Block IPv4-mapped IPv6 loopback
    if (host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:172.') || host.startsWith('::ffff:192.') || host.startsWith('::ffff:169.')) return false
    // Block decimal-encoded IPs
    if (/^\d+$/.test(host)) return false
    if (/^(169\.254\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(host)) return false
    return true
  } catch { return false }
}

/**
 * Full SSRF guard: literal-host check plus DNS resolution, blocking a hostname
 * that *resolves* to an internal address (rebinding-style bypass of the
 * literal check alone). Checks both A and AAAA records — an IPv4-only check
 * here previously let an AAAA-only internal record through.
 */
export async function isSafeURL(raw: string): Promise<boolean> {
  if (!isSafeBaseUrl(raw)) return false
  try {
    const u = new URL(raw)
    const [v4, v6] = await Promise.all([
      dns.resolve4(u.hostname).catch(() => [] as string[]),
      dns.resolve6(u.hostname).catch(() => [] as string[]),
    ])
    for (const ip of v4) {
      if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(ip)) return false
    }
    for (const ip of v6) {
      if (ip === '::1' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return false
    }
    return true
  } catch { return false }
}
