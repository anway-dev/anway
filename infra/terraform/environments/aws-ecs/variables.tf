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

variable "gateway_cpu" {
  type    = number
  default = 512
}

variable "gateway_memory" {
  type    = number
  default = 1024
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "gateway_replicas" {
  type    = number
  default = 2
}

variable "web_replicas" {
  type    = number
  default = 2
}

variable "gateway_image" {
  type    = string
  default = "anvay/gateway:latest"
}

variable "web_image" {
  type    = string
  default = "anvay/web:latest"
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
