FROM node:22-slim AS base
RUN npm install -g pnpm@9.15.4 --quiet
WORKDIR /app

# Install dependencies (monorepo-aware)
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway/package.json apps/gateway/
RUN pnpm install --frozen-lockfile --filter=anvay-gateway...

# Build TypeScript
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY . .
WORKDIR /app/apps/gateway
RUN pnpm exec prisma generate
RUN pnpm build

# Production image — distroless, non-root
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app
COPY --from=builder /app/apps/gateway/dist ./dist
COPY --from=builder /app/apps/gateway/node_modules ./node_modules
COPY --from=builder /app/apps/gateway/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 4000
CMD ["dist/src/server.js"]
