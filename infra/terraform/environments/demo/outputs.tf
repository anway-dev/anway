output "web_url" {
  value       = "http://localhost:${var.web_host_port}"
  description = "Anway web UI URL"
}

output "gateway_url" {
  value       = "http://localhost:${var.gateway_host_port}"
  description = "Anway gateway API URL"
}

output "database_url" {
  value     = "postgresql://anway:${var.postgres_password}@localhost:${var.postgres_host_port}/anway"
  sensitive = true
}

output "redis_url" {
  value = "redis://localhost:${var.redis_host_port}"
}

output "neo4j_url" {
  value = "http://localhost:${var.neo4j_http_port}"
}

output "network_name" {
  value = docker_network.anway.name
}
