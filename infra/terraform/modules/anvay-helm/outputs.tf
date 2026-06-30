output "namespace" {
  value = kubernetes_namespace.anway.metadata[0].name
}

output "release_name" {
  value = helm_release.anway.name
}

output "release_status" {
  value = helm_release.anway.status
}
