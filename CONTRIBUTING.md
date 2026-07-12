# Contributing to Anway

Thanks for your interest in contributing. This guide covers the basics.

## Prerequisites

- **Node.js** 22+
- **pnpm** 9.15.4 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- **Docker** + Docker Compose (for the local stack: Postgres, Redis, Neo4j,
  Prometheus, Grafana, Loki)
- **Python** 3.12+ (for `apps/agent-service`)

## Setup

```bash
git clone <your-fork>
cd anway
pnpm install

# local infra secrets — copy the template and set real values
cp infra/.env.example infra/.env   # then edit infra/.env

# bring up the dev stack
docker compose -f infra/docker-compose.dev.yml up -d
```

The web app runs on `:8500`, the gateway on `:8510`. See the root `README.md`
for the full layout.

## Repository layout

```
apps/        web (Next.js) · landing (static) · gateway (Fastify) · agent-service (FastAPI) · cli
packages/    agent (harness) · collection · repo · k8s · ui · types
connectors/  one folder per datasource (agent.ts + bootstrap.ts)
infra/       docker-compose, helm, terraform
```

## Development workflow

1. Branch off `main` (`feat/…`, `fix/…`).
2. Make focused changes; match the surrounding code style.
   - **Web UI uses inline styles only** — no Tailwind.
   - Keep the connector shape consistent (see any folder under `connectors/`).
3. Run checks locally before pushing:
   ```bash
   pnpm -r typecheck          # or: npx tsc --noEmit per app
   pnpm -r test               # unit tests
   pnpm --filter anway-web exec playwright test   # e2e (needs the stack up)
   ```
4. Open a PR against `main`. CI runs typecheck, unit tests, e2e, and build.

## Guidelines

- **No secrets in commits.** Use env vars; `infra/.env` is gitignored. A
  `.gitleaks.toml` allowlist exists only for upstream vendor-spec examples.
- **No stubs/mocks in production paths.** Fail honestly rather than fabricate.
- **Every write action stays gated** (V1 L2 posture) and audited.
- Keep PRs scoped and describe the change + how you verified it.

## Reporting bugs / security issues

- Functional bugs: open a GitHub issue with repro steps.
- Security vulnerabilities: **do not** open a public issue — see
  [`SECURITY.md`](./SECURITY.md).

By contributing you agree your contributions are licensed under the
[MIT License](./LICENSE).
