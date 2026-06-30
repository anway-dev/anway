output "cluster_name" {
  value = module.gke.name
}

output "cluster_endpoint" {
  value     = module.gke.endpoint
  sensitive = true
}

output "cloud_sql_private_ip" {
  value     = google_sql_database_instance.anway.private_ip_address
  sensitive = true
}

output "redis_host" {
  value     = google_redis_instance.anway.host
  sensitive = true
}

output "app_namespace" {
  value = module.anway_app.namespace
}

output "configure_kubectl" {
  value = "gcloud container clusters get-credentials ${module.gke.name} --region ${var.gcp_region} --project ${var.gcp_project_id}"
}
