variable "app_name" {
  type    = string
  default = "anvay"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "k8s_version" {
  type    = string
  default = "1.29"
}

variable "node_instance_type" {
  type    = string
  default = "t3.medium"
}

variable "node_min_count" {
  type    = number
  default = 1
}

variable "node_max_count" {
  type    = number
  default = 5
}

variable "node_desired_count" {
  type    = number
  default = 2
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.medium"
}

variable "db_storage_gb" {
  type    = number
  default = 20
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "encryption_key" {
  type      = string
  sensitive = true
}

variable "postgres_password" {
  type      = string
  sensitive = true
}

variable "neo4j_password" {
  type      = string
  sensitive = true
}

variable "gateway_image" {
  type    = string
  default = "anvay/gateway:latest"
}

variable "web_image" {
  type    = string
  default = "anvay/web:latest"
}

variable "gateway_replicas" {
  type    = number
  default = 2
}

variable "web_replicas" {
  type    = number
  default = 2
}

variable "app_hostname" {
  type    = string
  default = "anvay.example.com"
}

variable "tls_secret_name" {
  type    = string
  default = ""
}
