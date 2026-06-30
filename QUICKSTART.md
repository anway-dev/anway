# Anway Quick Start

## 1. Start infra

```bash
docker compose -f infra/docker-compose.yml up -d
```

## 2. Configure + migrate

```bash
cp apps/gateway/.env.example apps/gateway/.env
pnpm install
cd apps/gateway && pnpm prisma migrate deploy && cd ../..
```

## 3. Start app (two terminals)

```bash
# Terminal 1 — Gateway (http://localhost:4000)
cd apps/gateway && pnpm dev

# Terminal 2 — Web UI (http://localhost:3000)
cd apps/web && pnpm dev
```

## 4. Open http://localhost:3000

Configure your AI provider in the web UI — no .env editing needed.
Enter your API key, select a model, start chatting.
