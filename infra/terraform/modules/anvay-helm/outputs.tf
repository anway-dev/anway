output "namespace" {
  value = kubernetes_namespace.anvay.metadata[0].name
}

output "release_name" {
  value = helm_release.anvay.name
}

output "release_status" {
  value = helm_release.anvay.status
}
