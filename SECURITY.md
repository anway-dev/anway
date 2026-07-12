# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue for anything exploitable.

- Use GitHub's **"Report a vulnerability"** (Security → Advisories) on this
  repository, or
- Email the maintainers at **security@anway.dev**.

Include: a description, affected component/version, reproduction steps, and
impact. We aim to acknowledge within 3 business days and to provide a
remediation timeline after triage. Please give us reasonable time to release a
fix before any public disclosure.

## Supported versions

This project is pre-1.0; security fixes land on `main`. Pin a commit if you
need stability.

## Non-production defaults (important)

The repo ships **development defaults** so the stack runs locally out of the
box. These are **not secrets** and **must be changed** before any deployment:

| Where | Default | Action |
|-------|---------|--------|
| `infra/.env.example` | `POSTGRES_PASSWORD`, `NEO4J_PASSWORD`, `GF_SECURITY_ADMIN_PASSWORD`, `JWT_SECRET` = `CHANGE_ME` | Set real values in your own `infra/.env` (gitignored). |
| Seed / tests | `E2ETestPassword2026!` (demo users), `anway-demo-webhook-token` | Only used by the demo seed and e2e tests; override via env in real use. |
| CI | `anway_dev_secret`, `ci-test-secret-not-for-real-use-32chars` | Throwaway CI-only values. |

The gateway enforces this at runtime: `assertSecureJwtSecret`
(`apps/gateway/src/config/env.ts`) **refuses to start in production** with a
known-default or weak `JWT_SECRET`.

## Design guarantees

- **Deterministic access perimeter** — agent actions are gated by a rule
  engine, not LLM judgment; out-of-scope actions are hard-blocked and audited.
- **V1 write posture** — every write action requires explicit human
  confirmation (L2 gate).
- **Immutable audit** — `audit_events` are append-only (enforced by a DB
  trigger); every action, including blocked ones, is logged.
- **Credentials at rest** — connector credentials are stored encrypted
  (`credentials_enc`), never in plaintext columns or the client bundle.
