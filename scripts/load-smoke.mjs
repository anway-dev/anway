// Lightweight load smoke — native Node (no k6/docker dependency).
// 10 concurrent virtual users, 60s, same endpoints and thresholds as
// scripts/load-test.k6.js: p95 < 500ms, error rate < 1%.
// Usage: GATEWAY_URL=http://localhost:8510 AUTH_TOKEN=... node scripts/load-smoke.mjs

const BASE = process.env.GATEWAY_URL || 'http://localhost:8510'
const TOKEN = process.env.AUTH_TOKEN || ''
const VUS = Number(process.env.VUS || 10)
const DURATION_MS = Number(process.env.DURATION_S || 60) * 1000

const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
const endpoints = [
  { name: 'health', url: `${BASE}/health`, headers: {} },
  { name: 'metrics', url: `${BASE}/metrics`, headers: {} },
  ...(TOKEN ? [
    { name: 'alerts', url: `${BASE}/api/alerts`, headers: authHeaders },
    { name: 'audit', url: `${BASE}/api/audit`, headers: authHeaders },
  ] : []),
]

const durations = []
let ok = 0, fail = 0

async function vu(deadline) {
  while (Date.now() < deadline) {
    for (const ep of endpoints) {
      const t0 = performance.now()
      try {
        const res = await fetch(ep.url, { headers: ep.headers, signal: AbortSignal.timeout(10_000) })
        durations.push(performance.now() - t0)
        res.status >= 200 && res.status < 400 ? ok++ : fail++
        await res.arrayBuffer().catch(() => {})
      } catch {
        durations.push(performance.now() - t0)
        fail++
      }
    }
    await new Promise(r => setTimeout(r, 100))
  }
}

const deadline = Date.now() + DURATION_MS
await Promise.all(Array.from({ length: VUS }, () => vu(deadline)))

durations.sort((a, b) => a - b)
const pct = q => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))] ?? 0
const total = ok + fail
const errRate = total ? fail / total : 1

console.log(`requests: ${total}  ok: ${ok}  failed: ${fail}  error-rate: ${(errRate * 100).toFixed(2)}%`)
console.log(`latency ms — p50: ${pct(0.5).toFixed(1)}  p95: ${pct(0.95).toFixed(1)}  p99: ${pct(0.99).toFixed(1)}  max: ${(durations.at(-1) ?? 0).toFixed(1)}`)
console.log(`rps: ${(total / (DURATION_MS / 1000)).toFixed(1)}`)

const p95pass = pct(0.95) < 500
const errPass = errRate < 0.01
console.log(`THRESHOLD p95<500ms: ${p95pass ? 'PASS' : 'FAIL'}`)
console.log(`THRESHOLD error-rate<1%: ${errPass ? 'PASS' : 'FAIL'}`)
process.exit(p95pass && errPass ? 0 : 1)
