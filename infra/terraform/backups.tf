# AWS RDS automated backups (wired to rds-multi-az.tf)
# Backup retention already set on aws_db_instance.anvay_primary (backup_retention_period = 7)

# S3 export for point-in-time recovery
resource "aws_db_instance_automated_backups_replication" "anvay_backup_replication" {
  source_db_instance_arn = aws_db_instance.anvay_primary.arn
  retention_period       = 7
}

# Redis backup (ElastiCache snapshot)
resource "aws_elasticache_replication_group" "anvay_redis" {
  replication_group_id = "anvay-redis"
  description          = "Anvay Redis cluster"
  node_type            = "cache.t3.micro"
  num_cache_clusters   = 2
  snapshot_retention_limit = 3
  snapshot_window      = "03:00-04:00"
}

output "backup_schedule" {
  value = "RDS: daily automated backup, 7-day retention. Redis: 3-day snapshot retention, 03:00-04:00 UTC window."
}
