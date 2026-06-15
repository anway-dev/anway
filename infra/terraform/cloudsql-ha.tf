# GCP Cloud SQL HA — equivalent to AWS RDS Multi-AZ
# 
# Equivalent resources in GCP:
#   google_sql_database_instance with availability_type = "REGIONAL"
#   google_sql_database read_replica_type = "READ_REPLICA"
#
# Uncomment and configure below when deploying to GCP.
# Requires: credentials configured via GOOGLE_APPLICATION_CREDENTIALS env var or provider block.

# resource "google_sql_database_instance" "anvay_primary" {
#   name             = "anvay-postgres-primary"
#   database_version = "POSTGRES_15"
#   region           = var.gcp_region
# 
#   settings {
#     tier              = var.db_instance_class
#     availability_type = "REGIONAL"
#     disk_size         = 100
#     backup_configuration {
#       enabled                        = true
#       point_in_time_recovery_enabled = true
#       backup_retention_settings {
#         retained_backups = var.db_backup_retention
#       }
#     }
#   }
# }
# 
# resource "google_sql_database_instance" "anvay_replica" {
#   name                 = "anvay-postgres-replica"
#   database_version     = "POSTGRES_15"
#   region               = var.gcp_replica_region
#   master_instance_name = google_sql_database_instance.anvay_primary.name
# 
#   settings {
#     tier      = var.db_instance_class
#     disk_size = 100
#   }
# }
# 
# resource "google_sql_database" "anvay_db" {
#   name     = "anvay"
#   instance = google_sql_database_instance.anvay_primary.name
# }
# 
# resource "google_sql_user" "anvay_user" {
#   name     = var.db_username
#   instance = google_sql_database_instance.anvay_primary.name
#   password = var.db_password
# }
# 
# output "db_writer_endpoint" { value = google_sql_database_instance.anvay_primary.public_ip_address }
# output "db_reader_endpoint" { value = google_sql_database_instance.anvay_replica.public_ip_address }
