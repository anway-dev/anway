# Azure Database for PostgreSQL Flexible Server — equivalent to AWS RDS Multi-AZ
#
# Equivalent resources in Azure:
#   azurerm_postgresql_flexible_server with high_availability.mode = "ZoneRedundant"
#   azurerm_postgresql_flexible_server_database
#
# Uncomment and configure below when deploying to Azure.
# Requires: azurerm provider configured with subscription, resource group, etc.

# resource "azurerm_postgresql_flexible_server" "anvay_primary" {
#   name                = "anvay-postgres-primary"
#   resource_group_name = var.az_resource_group
#   location            = var.az_location
#   version             = "15"
# 
#   administrator_login    = var.db_username
#   administrator_password = var.db_password
# 
#   storage_mb        = 102400
#   sku_name          = var.db_instance_class
# 
#   backup_retention_days = var.db_backup_retention
#   geo_redundant_backup_enabled = true
# 
#   high_availability {
#     mode = "ZoneRedundant"
#   }
# }
# 
# resource "azurerm_postgresql_flexible_server_database" "anvay_db" {
#   name      = "anvay"
#   server_id = azurerm_postgresql_flexible_server.anvay_primary.id
# }
# 
# # Read replica (requires a separate Flexible Server with create_mode = "Replica")
# resource "azurerm_postgresql_flexible_server" "anvay_replica" {
#   name                = "anvay-postgres-replica"
#   resource_group_name = var.az_resource_group
#   location            = var.az_replica_location
#   create_mode         = "Replica"
#   source_server_id    = azurerm_postgresql_flexible_server.anvay_primary.id
# 
#   storage_mb = 102400
#   sku_name   = var.db_instance_class
# }
# 
# output "db_writer_endpoint" { value = azurerm_postgresql_flexible_server.anvay_primary.fqdn }
# output "db_reader_endpoint" { value = azurerm_postgresql_flexible_server.anvay_replica.fqdn }
