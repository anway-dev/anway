FROM node:22 AS base
RUN npm install -g pnpm@9.15.4 --quiet
WORKDIR /app

# --- deps: install all workspace dependencies ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/agent/package.json packages/agent/
COPY packages/cli-adapter/package.json packages/cli-adapter/
COPY packages/mcp-adapter/package.json packages/mcp-adapter/
COPY packages/types/package.json packages/types/
COPY connectors/argocd/package.json connectors/argocd/
COPY connectors/aws-cloudwatch/package.json connectors/aws-cloudwatch/
COPY connectors/aws-health/package.json connectors/aws-health/
COPY connectors/azure-monitor/package.json connectors/azure-monitor/
COPY connectors/circleci/package.json connectors/circleci/
COPY connectors/confluence/package.json connectors/confluence/
COPY connectors/coralogix/package.json connectors/coralogix/
COPY connectors/datadog/package.json connectors/datadog/
COPY connectors/dynatrace/package.json connectors/dynatrace/
COPY connectors/ecs/package.json connectors/ecs/
COPY connectors/eks/package.json connectors/eks/
COPY connectors/elastic/package.json connectors/elastic/
COPY connectors/gcp-monitoring/package.json connectors/gcp-monitoring/
COPY connectors/github/package.json connectors/github/
COPY connectors/gke/package.json connectors/gke/
COPY connectors/grafana/package.json connectors/grafana/
COPY connectors/jenkins/package.json connectors/jenkins/
COPY connectors/jira/package.json connectors/jira/
COPY connectors/k8s/package.json connectors/k8s/
COPY connectors/launchdarkly/package.json connectors/launchdarkly/
COPY connectors/linear/package.json connectors/linear/
COPY connectors/loki/package.json connectors/loki/
COPY connectors/newrelic/package.json connectors/newrelic/
COPY connectors/notion/package.json connectors/notion/
COPY connectors/opsgenie/package.json connectors/opsgenie/
COPY connectors/pagerduty/package.json connectors/pagerduty/
COPY connectors/prometheus/package.json connectors/prometheus/
COPY connectors/sentry/package.json connectors/sentry/
COPY connectors/slack/package.json connectors/slack/
COPY connectors/snyk/package.json connectors/snyk/
COPY connectors/sonarqube/package.json connectors/sonarqube/
COPY connectors/terraform/package.json connectors/terraform/
COPY connectors/vault/package.json connectors/vault/
COPY connectors/vercel/package.json connectors/vercel/
# --ignore-scripts: this stage only copies package.json files (for layer
# caching), not the full source — apps/gateway's postinstall runs
# `prisma generate`, which needs prisma/schema.prisma. That file isn't copied
# until the builder stage's `COPY . .` below, where `prisma generate` already
# runs explicitly. Without --ignore-scripts here, the implicit postinstall
# hook fires early and fails with "Could not find Prisma Schema" (confirmed
# live).
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- builder: compile TypeScript + generate Prisma client ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/gateway/node_modules ./apps/gateway/node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=deps /app/packages/cli-adapter/node_modules ./packages/cli-adapter/node_modules
COPY --from=deps /app/packages/mcp-adapter/node_modules ./packages/mcp-adapter/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /app/connectors/argocd/node_modules ./connectors/argocd/node_modules
COPY --from=deps /app/connectors/aws-cloudwatch/node_modules ./connectors/aws-cloudwatch/node_modules
COPY --from=deps /app/connectors/aws-health/node_modules ./connectors/aws-health/node_modules
COPY --from=deps /app/connectors/azure-monitor/node_modules ./connectors/azure-monitor/node_modules
COPY --from=deps /app/connectors/circleci/node_modules ./connectors/circleci/node_modules
COPY --from=deps /app/connectors/confluence/node_modules ./connectors/confluence/node_modules
COPY --from=deps /app/connectors/coralogix/node_modules ./connectors/coralogix/node_modules
COPY --from=deps /app/connectors/datadog/node_modules ./connectors/datadog/node_modules
COPY --from=deps /app/connectors/dynatrace/node_modules ./connectors/dynatrace/node_modules
COPY --from=deps /app/connectors/ecs/node_modules ./connectors/ecs/node_modules
COPY --from=deps /app/connectors/eks/node_modules ./connectors/eks/node_modules
COPY --from=deps /app/connectors/elastic/node_modules ./connectors/elastic/node_modules
COPY --from=deps /app/connectors/gcp-monitoring/node_modules ./connectors/gcp-monitoring/node_modules
COPY --from=deps /app/connectors/github/node_modules ./connectors/github/node_modules
COPY --from=deps /app/connectors/gke/node_modules ./connectors/gke/node_modules
COPY --from=deps /app/connectors/grafana/node_modules ./connectors/grafana/node_modules
COPY --from=deps /app/connectors/jenkins/node_modules ./connectors/jenkins/node_modules
COPY --from=deps /app/connectors/jira/node_modules ./connectors/jira/node_modules
COPY --from=deps /app/connectors/k8s/node_modules ./connectors/k8s/node_modules
COPY --from=deps /app/connectors/launchdarkly/node_modules ./connectors/launchdarkly/node_modules
COPY --from=deps /app/connectors/linear/node_modules ./connectors/linear/node_modules
COPY --from=deps /app/connectors/loki/node_modules ./connectors/loki/node_modules
COPY --from=deps /app/connectors/newrelic/node_modules ./connectors/newrelic/node_modules
COPY --from=deps /app/connectors/notion/node_modules ./connectors/notion/node_modules
COPY --from=deps /app/connectors/opsgenie/node_modules ./connectors/opsgenie/node_modules
COPY --from=deps /app/connectors/pagerduty/node_modules ./connectors/pagerduty/node_modules
COPY --from=deps /app/connectors/prometheus/node_modules ./connectors/prometheus/node_modules
COPY --from=deps /app/connectors/sentry/node_modules ./connectors/sentry/node_modules
COPY --from=deps /app/connectors/slack/node_modules ./connectors/slack/node_modules
COPY --from=deps /app/connectors/snyk/node_modules ./connectors/snyk/node_modules
COPY --from=deps /app/connectors/sonarqube/node_modules ./connectors/sonarqube/node_modules
COPY --from=deps /app/connectors/terraform/node_modules ./connectors/terraform/node_modules
COPY --from=deps /app/connectors/vault/node_modules ./connectors/vault/node_modules
COPY --from=deps /app/connectors/vercel/node_modules ./connectors/vercel/node_modules
COPY . .
# `anway-gateway^...` (the `^...` suffix) tells pnpm to build every workspace
# package anway-gateway depends on — @anway/types, @anway/agent,
# @anway/cli-adapter, @anway/mcp-adapter, and all ~33 @anway/connector-*
# packages — in correct topological order, WITHOUT building anway-gateway
# itself yet (that has to wait for `prisma generate` below). The previous two
# explicit `--filter` lines only built @anway/types and @anway/agent — every
# other workspace dependency's dist/ output (and therefore its .d.ts
# declarations) never existed, so gateway's own `tsc` failed with "Cannot
# find module '@anway/connector-*'" etc. across dozens of files (confirmed
# live).
RUN pnpm --filter anway-gateway^... build
RUN cd apps/gateway && pnpm exec prisma generate
RUN pnpm --filter anway-gateway build

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

# Copy node_modules — root .pnpm store + gateway-scoped deps
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/gateway/node_modules ./apps/gateway/node_modules

# Prisma engine files (generated by prisma generate in builder)
RUN mkdir -p node_modules/.prisma/client
RUN find node_modules/.pnpm/@prisma+client*/node_modules/.prisma -type f -exec cp {} node_modules/.prisma/client/ \; 2>/dev/null || true

# Copy built dist + prisma schema (into gateway dir for workspace resolution)
COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/apps/gateway/prisma ./apps/gateway/prisma
COPY --from=builder /app/apps/gateway/package.json ./apps/gateway/package.json

# Copy workspace packages (targets for @anway/* symlinks in node_modules)
COPY --from=builder /app/packages/agent ./packages/agent
COPY --from=builder /app/packages/cli-adapter ./packages/cli-adapter
COPY --from=builder /app/packages/mcp-adapter ./packages/mcp-adapter
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/connectors/argocd ./connectors/argocd
COPY --from=builder /app/connectors/aws-cloudwatch ./connectors/aws-cloudwatch
COPY --from=builder /app/connectors/aws-health ./connectors/aws-health
COPY --from=builder /app/connectors/azure-monitor ./connectors/azure-monitor
COPY --from=builder /app/connectors/circleci ./connectors/circleci
COPY --from=builder /app/connectors/confluence ./connectors/confluence
COPY --from=builder /app/connectors/coralogix ./connectors/coralogix
COPY --from=builder /app/connectors/datadog ./connectors/datadog
COPY --from=builder /app/connectors/dynatrace ./connectors/dynatrace
COPY --from=builder /app/connectors/ecs ./connectors/ecs
COPY --from=builder /app/connectors/eks ./connectors/eks
COPY --from=builder /app/connectors/elastic ./connectors/elastic
COPY --from=builder /app/connectors/gcp-monitoring ./connectors/gcp-monitoring
COPY --from=builder /app/connectors/github ./connectors/github
COPY --from=builder /app/connectors/gke ./connectors/gke
COPY --from=builder /app/connectors/grafana ./connectors/grafana
COPY --from=builder /app/connectors/jenkins ./connectors/jenkins
COPY --from=builder /app/connectors/jira ./connectors/jira
COPY --from=builder /app/connectors/k8s ./connectors/k8s
COPY --from=builder /app/connectors/launchdarkly ./connectors/launchdarkly
COPY --from=builder /app/connectors/linear ./connectors/linear
COPY --from=builder /app/connectors/loki ./connectors/loki
COPY --from=builder /app/connectors/newrelic ./connectors/newrelic
COPY --from=builder /app/connectors/notion ./connectors/notion
COPY --from=builder /app/connectors/opsgenie ./connectors/opsgenie
COPY --from=builder /app/connectors/pagerduty ./connectors/pagerduty
COPY --from=builder /app/connectors/prometheus ./connectors/prometheus
COPY --from=builder /app/connectors/sentry ./connectors/sentry
COPY --from=builder /app/connectors/slack ./connectors/slack
COPY --from=builder /app/connectors/snyk ./connectors/snyk
COPY --from=builder /app/connectors/sonarqube ./connectors/sonarqube
COPY --from=builder /app/connectors/terraform ./connectors/terraform
COPY --from=builder /app/connectors/vault ./connectors/vault
COPY --from=builder /app/connectors/vercel ./connectors/vercel

ENV NODE_ENV=production
WORKDIR /app/apps/gateway
USER node
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
