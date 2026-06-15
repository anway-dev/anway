output "alb_dns" {
  value       = aws_lb.anvay.dns_name
  description = "ALB DNS name — point your domain CNAME here"
}

output "web_url" {
  value = "http://${aws_lb.anvay.dns_name}"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.anvay.name
}

output "rds_endpoint" {
  value     = aws_db_instance.anvay.address
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.anvay.primary_endpoint_address
  sensitive = true
}
