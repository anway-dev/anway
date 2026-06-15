# Azure PostgreSQL Flexible Server + Redis Cache backups
# Equivalent to AWS RDS automated backups + ElastiCache snapshots.

# PostgreSQL Flexible Server automated backups are configured inline:
#   azurerm_postgresql_flexible_server.anvay_primary.backup_retention_days = 7
#   azurerm_postgresql_flexible_server.anvay_primary.geo_redundant_backup_enabled = true

# Azure Cache for Redis (equivalent to ElastiCache):
# resource "azurerm_redis_cache" "anvay_redis" {
#   name                = "anvay-redis"
#   resource_group_name = var.az_resource_group
#   location            = var.az_location
#   capacity            = 1
#   family              = "C"
#   sku_name            = "Standard"
#   redis_version       = "6"
#   minimum_tls_version = "1.2"
# 
#   redis_configuration {
#     rdb_backup_enabled       = true
#     rdb_backup_frequency     = 1440
#     rdb_backup_max_snapshot_count = 3
#   }
# }

# output "backup_schedule" {
#   value = "PostgreSQL: 7-day retention with geo-redundant backup. Redis Cache: daily RDB snapshots, 3 retained."
# }
