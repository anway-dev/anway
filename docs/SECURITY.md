# Security

Anway is a multi-tenant platform connecting to an organisation's entire software lifecycle. Security is foundational, not additive.

## Encryption at Rest

### Connector Credentials (S1)
- All connector credentials (API keys, tokens) are encrypted with **AES-256-GCM** before storage
- Encryption key: `ANWAY_ENCRYPTION_KEY` env var (base64-encoded 32-byte key)
- Key never leaves the gateway container — no key in client bundle, no key in localStorage
- Decryption happens only at call sites (`crypto.decryptJson`) — never in transit or at rest unencrypted
- Rotate keys by generating a new key, updating `ANWAY_ENCRYPTION_KEY`, and re-encrypting all stored credentials

### Database
- All sensitive fields in `connector_config.credentials_enc` are encrypted before INSERT
- Column type: `TEXT` — encrypted blob, never plaintext
- No plaintext credential columns exist in the schema

## Token Model

### JWT Authentication
- **Development:** HS256 symmetric secret via `JWT_SECRET` env var
- **Production:** RS256 asymmetric key pair via `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` env vars
- Token payload: `{ sub (userId), email, tenantId, role }`
- Expiry: 24 hours
- All authenticated routes use `@fastify/jwt` with `request.jwtVerify()`

### OIDC SSO
- IdP integration via `openid-client` (OIDC certified library)
- PKCE flow with `S256` code challenge — no client secret in browser
- State cookie signed by Fastify JWT (httpOnly, sameSite=lax, 10min TTL)
- IdP callback: validates state, exchanges code, upserts user, issues same JWT
- Supports any OIDC-compliant IdP (Dex, Okta, Azure AD, Google, etc.)
- Configuration via `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_TENANT_ID`
- Gateway starts normally without OIDC configured — `/auth/oidc/*` routes return 404

### Connector API Keys
- Format: `CONNECTOR_API_KEYS=key1:tenantId1,key2:tenantId2`
- Each key is bound to a specific tenant — cross-tenant writes rejected (403)
- Required for `/api/graph/events` — unauthenticated access returns 401
- Webhook auth: static `ANWAY_WEBHOOK_TOKEN` for machine senders (Alertmanager, CI, Gitea)

## Perimeter Enforcement

### Deterministic Rule Engine
- Every tool call passes through `AgentPerimeter.allows(toolCall)` — **not LLM judgment**
- Hard block on denial — audit event `tool_call_blocked` logged
- Connector mode per user: `read | write | read-write` per connector type
- Resource-level scoping: wildcard (`*`) or specific resource IDs
- `isWriteAction` gates all write tools (create, update, delete, deploy, restart)
- V1 trust contract: all write actions go through L2 Approve gate (user confirmation)

### Gate System (L2 Approve)
- Write actions require explicit user confirmation before execution
- `IGateSink` → Redis (hot path) + Postgres (durable record)
- Gate decisions immutable at DB level (RESTRICTIVE `gate_no_delete` policy)
- Gate TTL: 10 minutes — must exceed poll timeout + human response window
- Decided gates: `decided_by` column records user who approved

## Rate Limiting
- API routes: 300 requests per minute per IP (`@fastify/rate-limit`)
- Webhook routes: 600 requests per minute per IP
- Auth token endpoint: 5 requests per minute per IP (in-memory throttle)
- Token budget per-tenant tracked via `TokenBudget` middleware

## Audit Trail
- Every query, tool call, gate event, and mutation is immutably logged
- Stored in `audit_events` table with `event_type`, `tenant_id`, `user_id`, `session_id`, `payload`
- RLS enforced: users can only see their tenant's audit events
- Immutable: audit_events table has no DELETE policy (app-level + DB constraint)
- Export: NDJSON via `GET /api/audit/export`
- Retention: 90 days (purged by `data_retention` cron job at 3am daily)

## Row-Level Security
- All multi-tenant tables enforce `FORCE ROW LEVEL SECURITY`
- `tenant_isolation` policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid)` + `WITH CHECK`
- Unset GUC → all rows invisible (fail-closed)
- Maintenance operations: `SET LOCAL row_security = off` for admin-purview tasks (freshness daemon)

## Secrets Management
- No API keys in client bundle (Next.js) — keys read from `process.env` server-side only
- No API keys in localStorage — all authentication via httpOnly JWT cookies or Authorization header
- No API keys in git — `.env.example` shows variable names, never values
- `ANWAY_ENCRYPTION_KEY` must be a 32-byte base64 key, generated: `openssl rand -base64 32`
- `JWT_SECRET` must be changed from `dev-secret-change-in-production` before production deployment

## Webhook Auth
- Inbound webhooks: `Authorization: Bearer <ANWAY_WEBHOOK_TOKEN>`
- Tenant determined by `ANWAY_WEBHOOK_TENANT` env var
- Incorrect or missing token → 401

## Docker Security
- Gateway runs as `USER node` (not root)
- Node.js version: 22 (LTS) — not slim variant for OpenSSL compatibility
- Build-time secrets excluded from final image via multi-stage builds
- No `ARG` values leaked in final image layers

## Reporting
- Security vulnerabilities: report to `security@anway.dev`
- Do not file public issues for security findings
- SLA: acknowledgment within 48 hours, resolution within 7 days for critical
