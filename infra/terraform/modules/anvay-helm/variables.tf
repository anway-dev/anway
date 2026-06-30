variable "namespace" {
  type    = string
  default = "anway"
}

variable "environment" {
  type = string
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "encryption_key" {
  type      = string
  sensitive = true
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type      = string
  sensitive = true
}

variable "neo4j_uri" {
  type      = string
  sensitive = true
}

variable "neo4j_password" {
  type      = string
  sensitive = true
}

variable "gateway_image" {
  type    = string
  default = "anway/gateway:latest"
}

variable "web_image" {
  type    = string
  default = "anway/web:latest"
}

variable "gateway_replicas" {
  type    = number
  default = 1
}

variable "web_replicas" {
  type    = number
  default = 1
}

variable "ingress_enabled" {
  type    = bool
  default = false
}

variable "ingress_class" {
  type    = string
  default = "nginx"
}

variable "app_hostname" {
  type    = string
  default = "anway.example.com"
}

variable "tls_secret_name" {
  type    = string
  default = ""
}
