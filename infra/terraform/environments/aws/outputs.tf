output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value     = aws_db_instance.anvay.address
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.anvay.primary_endpoint_address
  sensitive = true
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "app_namespace" {
  value = module.anvay_app.namespace
}

output "configure_kubectl" {
  value = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
