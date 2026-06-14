// k6 load baseline — run with: k6 run scripts/load-test.k6.js
// Requires: GATEWAY_URL env var (default http://localhost:4000)
// Requires: AUTH_TOKEN env var (obtain with: curl http://localhost:4000/api/auth/dev-token)
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up
    { duration: '60s', target: 10 },   // hold
    { duration: '15s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile under 500ms
    http_req_failed: ['rate<0.01'],     // <1% error rate
  },
}

const BASE = __ENV.GATEWAY_URL || 'http://localhost:4000'
const TOKEN = __ENV.AUTH_TOKEN || ''
const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}

export default function () {
  // Health check (no auth)
  const health = http.get(`${BASE}/health`)
  check(health, { 'health 200': (r) => r.status === 200 })

  // Metrics (no auth)
  const metrics = http.get(`${BASE}/metrics`)
  check(metrics, { 'metrics 200': (r) => r.status === 200 })

  if (TOKEN) {
    // Authenticated endpoints
    const alerts = http.get(`${BASE}/api/alerts`, { headers })
    check(alerts, { 'alerts 200': (r) => r.status === 200 })

    const audit = http.get(`${BASE}/api/audit`, { headers })
    check(audit, { 'audit 200': (r) => r.status === 200 })
  }

  sleep(1)
}
