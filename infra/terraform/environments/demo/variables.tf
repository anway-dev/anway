variable "app_name" {
  type    = string
  default = "anway"
}

variable "environment" {
  type    = string
  default = "demo"
}

variable "jwt_secret" {
  type      = string
  sensitive = true
  default   = "demo-jwt-secret-change-in-prod"
}

variable "encryption_key" {
  type      = string
  sensitive = true
  default   = "demo-encryption-key-32bytes!!!!!"
}

variable "postgres_password" {
  type      = string
  sensitive = true
  default   = "anway"
}

variable "neo4j_password" {
  type      = string
  sensitive = true
  default   = "anwaypassword"
}

variable "gateway_image" {
  type    = string
  default = "anway/gateway:latest"
}

variable "web_image" {
  type    = string
  default = "anway/web:latest"
}

# Host port mappings — can be overridden to avoid conflicts
variable "postgres_host_port" {
  type    = number
  default = 5432
}

variable "redis_host_port" {
  type    = number
  default = 6379
}

variable "neo4j_http_port" {
  type    = number
  default = 7474
}

variable "neo4j_bolt_port" {
  type    = number
  default = 7687
}

variable "gateway_host_port" {
  type    = number
  default = 4000
}

variable "web_host_port" {
  type    = number
  default = 3000
}
