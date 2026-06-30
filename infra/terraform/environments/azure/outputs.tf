output "resource_group" {
  value = azurerm_resource_group.anway.name
}

output "aks_cluster_name" {
  value = azurerm_kubernetes_cluster.anway.name
}

output "postgres_fqdn" {
  value     = azurerm_postgresql_flexible_server.anway.fqdn
  sensitive = true
}

output "redis_hostname" {
  value     = azurerm_redis_cache.anway.hostname
  sensitive = true
}

output "app_namespace" {
  value = module.anway_app.namespace
}

output "configure_kubectl" {
  value = "az aks get-credentials --resource-group ${azurerm_resource_group.anway.name} --name ${azurerm_kubernetes_cluster.anway.name}"
}
