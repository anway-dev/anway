FROM node:22-slim AS base
RUN npm install -g pnpm@9.15.4 --quiet
WORKDIR /app

# --- deps: install all workspace dependencies ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/agent/package.json packages/agent/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

# --- builder: compile TypeScript ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
# Build workspace packages first (gateway depends on them)
RUN pnpm --filter @anvay/types build || true
RUN pnpm --filter @anvay/agent build || true
# Generate Prisma client in gateway
RUN cd apps/gateway && pnpm exec prisma generate
# Build gateway
RUN pnpm --filter anvay-gateway build

# --- runtime ---
FROM node:22 AS runtime
WORKDIR /app

# Install gh CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl ca-certificates \
  && ARCH=$(dpkg --print-architecture) \
  && wget -qO /tmp/gh.deb "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_${ARCH}.deb" \
  && apt-get install -y /tmp/gh.deb \
  && rm /tmp/gh.deb \
  && apt-get purge -y wget \
  && rm -rf /var/lib/apt/lists/*

# Copy built dist
COPY --from=builder /app/apps/gateway/dist ./dist
COPY --from=builder /app/apps/gateway/prisma ./prisma
COPY --from=builder /app/apps/gateway/package.json ./package.json

# Copy node_modules — root + gateway-scoped (includes @anvay/* symlink targets)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/gateway/node_modules ./gateway_node_modules

# Merge gateway-scoped modules (override root where needed)
RUN cp -rn gateway_node_modules/. node_modules/ 2>/dev/null || true && rm -rf gateway_node_modules

# Copy workspace packages (symlink targets for @anvay/agent, @anvay/types)
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/agent/package.json ./packages/agent/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json

# Generated Prisma client is in the pnpm store (already copied with node_modules above)

ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
