variable "app_name" {
  type    = string
  default = "anvay"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "subscription_id" {
  type = string
}

variable "azure_location" {
  type    = string
  default = "eastus"
}

variable "vnet_cidr" {
  type    = string
  default = "10.0.0.0/8"
}

variable "aks_subnet_cidr" {
  type    = string
  default = "10.240.0.0/16"
}

variable "db_subnet_cidr" {
  type    = string
  default = "10.241.0.0/24"
}

variable "k8s_version" {
  type    = string
  default = "1.29"
}

variable "node_vm_size" {
  type    = string
  default = "Standard_D2s_v3"
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

variable "db_sku_name" {
  type    = string
  default = "B_Standard_B1ms"
}

variable "db_storage_mb" {
  type    = number
  default = 32768
}

variable "redis_sku" {
  type    = string
  default = "Basic"
}

variable "redis_family" {
  type    = string
  default = "C"
}

variable "redis_capacity" {
  type    = number
  default = 0
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
