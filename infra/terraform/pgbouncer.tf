# PgBouncer — transaction-mode pooling for Postgres
# Provision per-environment. Connects gateway pods → PgBouncer → Postgres.
# Required for production at scale (100+ concurrent connections).
variable "pgbouncer_enabled" {
  default     = false
  description = "Enable PgBouncer connection pooling"
}

# Placeholder: wire up your cloud-specific PgBouncer deployment here.
# EKS: deploy pgbouncer Helm chart to cluster
# GCP: Cloud SQL Proxy in transaction mode
# Azure: PgBouncer on Azure Container Instances
