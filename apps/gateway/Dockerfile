FROM node:22-slim AS base
RUN npm install -g pnpm@9.15.4 --quiet
WORKDIR /app

# Install dependencies (monorepo-aware)
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/agent/package.json packages/agent/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --filter=anvay-gateway...

# Build TypeScript
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
WORKDIR /app/apps/gateway
RUN pnpm exec prisma generate
RUN pnpm build
WORKDIR /app
RUN pnpm deploy --filter=anvay-gateway /app/deploy --prod

# Runtime stage — node:22 (not slim) for openssl compatibility with Prisma
FROM node:22 AS runtime
WORKDIR /app

# Install gh CLI (GitHub's official package)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    ca-certificates \
  && ARCH=$(dpkg --print-architecture) \
  && wget -qO /tmp/gh.deb "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_${ARCH}.deb" \
  && apt-get install -y /tmp/gh.deb \
  && rm /tmp/gh.deb \
  && apt-get purge -y wget \
  && rm -rf /var/lib/apt/lists/*

# Copy built output from builder
COPY --from=builder /app/apps/gateway/dist ./dist
COPY --from=builder /app/apps/gateway/prisma ./prisma
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./package.json
# Copy the generated Prisma client from the builder stage
COPY --from=builder /app/apps/gateway/node_modules/.prisma ./node_modules/.prisma
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
