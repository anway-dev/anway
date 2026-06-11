# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: anvay.spec.ts >> I: Web UI >> I.1 homepage loads at /
- Location: e2e/anvay.spec.ts:205:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "networkidle"

```

# Test source

```ts
  106 | 
  107 |   test('C.2 GET /api/connectors without JWT returns 401', async ({ request }) => {
  108 |     const resp = await request.get(`${GATEWAY}/api/connectors`)
  109 |     expect(resp.status()).toBe(401)
  110 |   })
  111 | })
  112 | 
  113 | // ---------------------------------------------------------------------------
  114 | // Suite D — Incidents API
  115 | // ---------------------------------------------------------------------------
  116 | test.describe('D: Incidents', () => {
  117 |   test('D.1 GET /api/incidents returns list', async ({ request }) => {
  118 |     const authResp = await request.post(`${GATEWAY}/auth/token`, {
  119 |       data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
  120 |     })
  121 |     const { token } = await authResp.json()
  122 |     const resp = await request.get(`${GATEWAY}/api/incidents`, {
  123 |       headers: { Authorization: `Bearer ${token}` },
  124 |     })
  125 |     // May return 200 (list) or 404 (no incidents)
  126 |     expect([200, 404]).toContain(resp.status())
  127 |   })
  128 | })
  129 | 
  130 | // ---------------------------------------------------------------------------
  131 | // Suite E — Gate API
  132 | // ---------------------------------------------------------------------------
  133 | test.describe('E: Gate', () => {
  134 |   test('E.1 gate decide on non-existent gate returns 404', async ({ request }) => {
  135 |     const authResp = await request.post(`${GATEWAY}/auth/token`, {
  136 |       data: { email: DEMO_EMAIL, tenantId: DEMO_TENANT },
  137 |     })
  138 |     const { token } = await authResp.json()
  139 |     const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000099/decide`, {
  140 |       headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  141 |       data: { decision: 'approved' },
  142 |     })
  143 |     expect(resp.status()).toBe(404)
  144 |   })
  145 | 
  146 |   test('E.2 gate decide without JWT returns 401', async ({ request }) => {
  147 |     const resp = await request.post(`${GATEWAY}/api/gate/00000000-0000-0000-0000-000000000001/decide`, {
  148 |       data: { decision: 'approved' },
  149 |     })
  150 |     expect(resp.status()).toBe(401)
  151 |   })
  152 | })
  153 | 
  154 | // ---------------------------------------------------------------------------
  155 | // Suite F — Automations API
  156 | // ---------------------------------------------------------------------------
  157 | test.describe('F: Automations', () => {
  158 |   test('F.1 GET /api/automations/triggers returns list', async ({ request }) => {
  159 |     const h = await authHeaders(request)
  160 |     const resp = await request.get(`${GATEWAY}/api/automations/triggers`, { headers: h })
  161 |     expect(resp.status()).toBe(200)
  162 |     expect(Array.isArray(await resp.json())).toBe(true)
  163 |   })
  164 | 
  165 |   test('F.2 GET /api/automations/monitors returns list', async ({ request }) => {
  166 |     const h = await authHeaders(request)
  167 |     const resp = await request.get(`${GATEWAY}/api/automations/monitors`, { headers: h })
  168 |     expect(resp.status()).toBe(200)
  169 |     expect(Array.isArray(await resp.json())).toBe(true)
  170 |   })
  171 | })
  172 | 
  173 | // ---------------------------------------------------------------------------
  174 | // Suite G — Graph Events API
  175 | // ---------------------------------------------------------------------------
  176 | test.describe('G: Graph Events', () => {
  177 |   test('G.1 POST /api/graph/events without x-connector-key returns 401', async ({ request }) => {
  178 |     const resp = await request.post(`${GATEWAY}/api/graph/events`, {
  179 |       data: { type: 'pr_merged', tenantId: DEMO_TENANT },
  180 |     })
  181 |     // Graph events without auth may return 401 (no key) or 503 (service unavailable)
  182 |     expect([401, 503]).toContain(resp.status())
  183 |   })
  184 | })
  185 | 
  186 | // ---------------------------------------------------------------------------
  187 | // Suite H — Chat API
  188 | // ---------------------------------------------------------------------------
  189 | test.describe('H: Chat', () => {
  190 |   test('H.1 POST /api/chat without LLM key returns 200 or 503', async ({ request }) => {
  191 |     const h = await authHeaders(request)
  192 |     const resp = await request.post(`${GATEWAY}/api/chat`, {
  193 |       headers: { ...h, 'Content-Type': 'application/json' },
  194 |       data: { query: 'test', sessionId: 'test-session' },
  195 |     })
  196 |     // 503 = no LLM provider; 200 = streaming if provider configured
  197 |     expect([200, 503]).toContain(resp.status())
  198 |   })
  199 | })
  200 | 
  201 | // ---------------------------------------------------------------------------
  202 | // Suite I — Web UI Navigation
  203 | // ---------------------------------------------------------------------------
  204 | test.describe('I: Web UI', () => {
  205 |   test('I.1 homepage loads at /', async ({ page }) => {
> 206 |     await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  207 |     await expect(page.locator('body')).toBeVisible()
  208 |   })
  209 | 
  210 |   test('I.2 no page errors on load', async ({ page }) => {
  211 |     const errors: string[] = []
  212 |     page.on('pageerror', e => errors.push(e.message))
  213 |     await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 60_000 })
  214 |     expect(errors).toHaveLength(0)
  215 |   })
  216 | })
  217 | 
  218 | // ---------------------------------------------------------------------------
  219 | // Suite L — Security
  220 | // ---------------------------------------------------------------------------
  221 | test.describe('L: Security', () => {
  222 |   test('L.1 API key not in health response', async ({ request }) => {
  223 |     const resp = await request.get(`${GATEWAY}/health`)
  224 |     const text = await resp.text()
  225 |     expect(text).not.toContain('ANTHROPIC_API_KEY')
  226 |     expect(text).not.toContain('OPENAI_API_KEY')
  227 |   })
  228 | 
  229 |   test('L.2 CORS headers present on API', async ({ request }) => {
  230 |     const resp = await request.get(`${GATEWAY}/health`)
  231 |     // Fastify CORS plugin should set access-control headers
  232 |     expect(resp.status()).toBe(200)
  233 |   })
  234 | 
  235 |   test('L.3 JWT secret not exposed in any response', async ({ request }) => {
  236 |     const resp = await request.get(`${GATEWAY}/health`)
  237 |     const text = await resp.text()
  238 |     expect(text).not.toContain('JWT_SECRET')
  239 |   })
  240 | })
  241 | 
  242 | // ---------------------------------------------------------------------------
  243 | // Suite M — Metrics
  244 | // ---------------------------------------------------------------------------
  245 | test.describe('M: Metrics', () => {
  246 |   test('M.1 request counters increment after API calls', async ({ request }) => {
  247 |     const before = await request.get(`${GATEWAY}/metrics`)
  248 |     const beforeText = await before.text()
  249 | 
  250 |     await request.get(`${GATEWAY}/health`)
  251 | 
  252 |     const after = await request.get(`${GATEWAY}/metrics`)
  253 |     const afterText = await after.text()
  254 | 
  255 |     expect(beforeText).toContain('anvay_gateway')
  256 |     expect(afterText).toContain('anvay_gateway')
  257 |   })
  258 | })
  259 | 
  260 | // ---------------------------------------------------------------------------
  261 | // Suite D extended — Incident CRUD
  262 | // ---------------------------------------------------------------------------
  263 | test.describe('D extended: Incident CRUD', () => {
  264 |   let token: string
  265 |   let incidentId: string
  266 | 
  267 |   test.beforeAll(async ({ request }) => {
  268 |     token = await getToken(request)
  269 |   })
  270 | 
  271 |   test('D.2 POST /api/incidents creates incident', async ({ request }) => {
  272 |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  273 |       headers: { Authorization: `Bearer ${token}` },
  274 |       data: { title: 'E2E Test Incident', severity: 'high' },
  275 |     })
  276 |     expect([200, 201]).toContain(resp.status())
  277 |     const body = await resp.json()
  278 |     expect(body.id).toBeDefined()
  279 |     incidentId = body.id
  280 |   })
  281 | 
  282 |   test('D.3 GET /api/incidents/:id returns created incident', async ({ request }) => {
  283 |     const resp = await request.get(`${GATEWAY}/api/incidents/${incidentId}`, {
  284 |       headers: { Authorization: `Bearer ${token}` },
  285 |     })
  286 |     expect(resp.status()).toBe(200)
  287 |     const body = await resp.json()
  288 |     expect(body.title).toBe('E2E Test Incident')
  289 |   })
  290 | 
  291 |   test('D.4 GET /api/incidents/:nonexistent returns 404', async ({ request }) => {
  292 |     const resp = await request.get(`${GATEWAY}/api/incidents/00000000-0000-0000-0000-000000000099`, {
  293 |       headers: { Authorization: `Bearer ${token}` },
  294 |     })
  295 |     expect(resp.status()).toBe(404)
  296 |   })
  297 | 
  298 |   test('D.5 POST /api/incidents missing title returns 400', async ({ request }) => {
  299 |     const resp = await request.post(`${GATEWAY}/api/incidents`, {
  300 |       headers: { Authorization: `Bearer ${token}` },
  301 |       data: { severity: 'high' },
  302 |     })
  303 |     expect(resp.status()).toBe(400)
  304 |   })
  305 | 
  306 |   test('D.6 POST /api/incidents invalid severity returns 400', async ({ request }) => {
```