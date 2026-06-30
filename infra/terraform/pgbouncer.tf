variable "environment" { default = "dev" description = "Deployment environment (dev/staging/prod)" }

# PgBouncer — transaction-mode pooling for Postgres
# Provision per-environment. Connects gateway pods → PgBouncer → Postgres.
# Required for production at scale (100+ concurrent connections).
# Enabled automatically for prod environments; optional for staging/dev.

variable "pgbouncer_enabled" {
  default     = false
  description = "Enable PgBouncer connection pooling (auto-enabled for prod)"
}

variable "pgbouncer_pool_size" {
  default     = 25
  description = "PgBouncer default_pool_size per pg_catalog database"
}

# Production auto-enable: set pgbouncer_enabled = true when environment == "prod"
# Usage in environments/aws/main.tf (or equivalent):
#
#   module "pgbouncer" {
#     source    = "../../modules/pgbouncer-helm"
#     count     = var.environment == "prod" ? 1 : 0
#     namespace = module.anway_app.namespace
#     db_host   = aws_db_instance.anway.address
#     db_port   = 5432
#     db_name   = "anway"
#     db_user   = "anway"
#     db_password = var.postgres_password
#     pool_size   = var.pgbouncer_pool_size
#   }
#
# When PgBouncer is deployed, gateway DATABASE_URL must point to the PgBouncer
# service endpoint (e.g. pgbouncer.anway.svc:6432) instead of direct RDS.

# Post-deploy checklist:
# [ ] PgBouncer deployed and DATABASE_URL pointing to PgBouncer endpoint
# [ ] Connection pool monitoring enabled (pgbouncer-exporter or equivalent)
# [ ] Verify DB_POOL_SIZE env var does NOT set connection_limit when PgBouncer is in use
#     (PgBouncer handles pooling; app-level connection_limit should be unset or 1)
