variable "app_name" {
  type    = string
  default = "anvay"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "gcp_project_id" {
  type = string
}

variable "gcp_region" {
  type    = string
  default = "us-central1"
}

variable "gcp_zones" {
  type    = list(string)
  default = ["us-central1-a", "us-central1-b", "us-central1-c"]
}

variable "k8s_version" {
  type    = string
  default = "latest"
}

variable "subnet_cidr" {
  type    = string
  default = "10.0.0.0/20"
}

variable "pods_cidr" {
  type    = string
  default = "10.48.0.0/14"
}

variable "services_cidr" {
  type    = string
  default = "10.52.0.0/20"
}

variable "node_machine_type" {
  type    = string
  default = "e2-standard-2"
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

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "db_disk_gb" {
  type    = number
  default = 20
}

variable "redis_memory_gb" {
  type    = number
  default = 1
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
