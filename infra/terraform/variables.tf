variable "app_name" {
  description = "Application name prefix for all resources"
  type        = string
  default     = "anvay"
}

variable "environment" {
  description = "Deployment environment (demo, staging, prod)"
  type        = string
}

variable "jwt_secret" {
  description = "JWT signing secret for gateway"
  type        = string
  sensitive   = true
}

variable "encryption_key" {
  description = "32-byte AES key for credential encryption"
  type        = string
  sensitive   = true
}

variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
  default     = "anvay"
}

variable "neo4j_password" {
  description = "Neo4j password"
  type        = string
  sensitive   = true
  default     = "anvaypassword"
}

variable "gateway_image" {
  description = "Gateway container image"
  type        = string
  default     = "anvay/gateway:latest"
}

variable "web_image" {
  description = "Web container image"
  type        = string
  default     = "anvay/web:latest"
}

variable "gateway_replicas" {
  description = "Number of gateway pod replicas"
  type        = number
  default     = 1
}

variable "web_replicas" {
  description = "Number of web pod replicas"
  type        = number
  default     = 1
}
