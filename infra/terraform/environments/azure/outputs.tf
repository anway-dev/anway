output "resource_group" {
  value = azurerm_resource_group.anvay.name
}

output "aks_cluster_name" {
  value = azurerm_kubernetes_cluster.anvay.name
}

output "postgres_fqdn" {
  value     = azurerm_postgresql_flexible_server.anvay.fqdn
  sensitive = true
}

output "redis_hostname" {
  value     = azurerm_redis_cache.anvay.hostname
  sensitive = true
}

output "app_namespace" {
  value = module.anvay_app.namespace
}

output "configure_kubectl" {
  value = "az aks get-credentials --resource-group ${azurerm_resource_group.anvay.name} --name ${azurerm_kubernetes_cluster.anvay.name}"
}
