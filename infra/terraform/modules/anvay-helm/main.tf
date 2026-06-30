terraform {
  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }
  }
}

resource "kubernetes_namespace" "anway" {
  metadata {
    name = var.namespace
    labels = {
      app         = "anway"
      environment = var.environment
    }
  }
}

resource "kubernetes_secret" "anway_secrets" {
  metadata {
    name      = "anway-secrets"
    namespace = kubernetes_namespace.anway.metadata[0].name
  }

  data = {
    JWT_SECRET     = var.jwt_secret
    ENCRYPTION_KEY = var.encryption_key
    DATABASE_URL   = var.database_url
    REDIS_URL      = var.redis_url
    NEO4J_URI      = var.neo4j_uri
    NEO4J_USER     = "neo4j"
    NEO4J_PASSWORD = var.neo4j_password
  }
}

resource "helm_release" "anway" {
  name       = "anway"
  chart      = "${path.module}/../../../../helm/anway"
  namespace  = kubernetes_namespace.anway.metadata[0].name
  wait       = true
  timeout    = 300

  values = [
    yamlencode({
      replicaCount = {
        gateway = var.gateway_replicas
        web     = var.web_replicas
      }
      image = {
        gateway = {
          repository = split(":", var.gateway_image)[0]
          tag        = length(split(":", var.gateway_image)) > 1 ? split(":", var.gateway_image)[1] : "latest"
          pullPolicy = "IfNotPresent"
        }
        web = {
          repository = split(":", var.web_image)[0]
          tag        = length(split(":", var.web_image)) > 1 ? split(":", var.web_image)[1] : "latest"
          pullPolicy = "IfNotPresent"
        }
      }
      envFrom = [{
        secretRef = { name = kubernetes_secret.anway_secrets.metadata[0].name }
      }]
      ingress = {
        enabled   = var.ingress_enabled
        className = var.ingress_class
        host      = var.app_hostname
        tls       = var.tls_secret_name != "" ? [{ secretName = var.tls_secret_name, hosts = [var.app_hostname] }] : []
      }
      postgres = { enabled = false }
      redis    = { enabled = false }
    })
  ]
}
