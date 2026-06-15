# GCP Cloud SQL + Memorystore backups
# Equivalent to AWS RDS automated backups + ElastiCache snapshots.

# Cloud SQL automated backups are configured inline on the instance:
#   google_sql_database_instance.anvay_primary.settings.backup_configuration {
#     enabled                        = true
#     point_in_time_recovery_enabled = true
#     backup_retention_settings {
#       retained_backups = 7
#     }
#   }

# Memorystore for Redis (equivalent to ElastiCache):
# resource "google_redis_instance" "anvay_redis" {
#   name               = "anvay-redis"
#   tier               = "STANDARD_HA"
#   memory_size_gb     = 1
#   region             = var.gcp_region
#   redis_version      = "REDIS_7_0"
#   persistence_config {
#     persistence_mode    = "RDB"
#     rdb_snapshot_period = "TWENTY_FOUR_HOURS"
#   }
# }

# output "backup_schedule" {
#   value = "Cloud SQL: automated daily backup, 7-day retention with PITR. Memorystore: daily RDB snapshots."
# }
