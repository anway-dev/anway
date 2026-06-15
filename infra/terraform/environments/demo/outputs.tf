output "web_url" {
  value       = "http://localhost:${var.web_host_port}"
  description = "Anvay web UI URL"
}

output "gateway_url" {
  value       = "http://localhost:${var.gateway_host_port}"
  description = "Anvay gateway API URL"
}

output "database_url" {
  value     = "postgresql://anvay:${var.postgres_password}@localhost:${var.postgres_host_port}/anvay"
  sensitive = true
}

output "redis_url" {
  value = "redis://localhost:${var.redis_host_port}"
}

output "neo4j_url" {
  value = "http://localhost:${var.neo4j_http_port}"
}

output "network_name" {
  value = docker_network.anvay.name
}
