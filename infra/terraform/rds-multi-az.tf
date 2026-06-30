# AWS RDS Multi-AZ with read replica
# Required env vars: AWS_REGION, DB_INSTANCE_CLASS, DB_NAME, DB_USERNAME, DB_PASSWORD

variable "db_instance_class" { default = "db.t3.medium" }
variable "db_multi_az" { default = true }
variable "db_backup_retention" { default = 7 }
variable "db_username" { default = "" }
variable "db_password" { default = "", sensitive = true }

resource "aws_db_instance" "anway_primary" {
  identifier           = "anway-postgres-primary"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = var.db_instance_class
  allocated_storage    = 100
  multi_az             = var.db_multi_az
  backup_retention_period = var.db_backup_retention
  skip_final_snapshot  = false
  final_snapshot_identifier = "anway-postgres-final"
  
  db_name  = "anway"
  username = var.db_username
  password = var.db_password
  
  tags = { Name = "anway-postgres-primary", ManagedBy = "terraform" }
}

resource "aws_db_instance" "anway_replica" {
  identifier          = "anway-postgres-replica"
  replicate_source_db = aws_db_instance.anway_primary.identifier
  instance_class      = var.db_instance_class
  skip_final_snapshot = true
  tags = { Name = "anway-postgres-replica", ManagedBy = "terraform" }
}

output "db_writer_endpoint" { value = aws_db_instance.anway_primary.endpoint }
output "db_reader_endpoint" { value = aws_db_instance.anway_replica.endpoint }
