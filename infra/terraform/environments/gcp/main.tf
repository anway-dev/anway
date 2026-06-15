locals {
  name = "${var.app_name}-${var.environment}"
}

# ── APIs ──────────────────────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ── VPC ───────────────────────────────────────────────────────────────────────

resource "google_compute_network" "anvay" {
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "anvay" {
  name          = "${local.name}-nodes"
  ip_cidr_range = var.subnet_cidr
  region        = var.gcp_region
  network       = google_compute_network.anvay.id

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.services_cidr
  }
}

resource "google_compute_global_address" "private_ip_range" {
  name          = "${local.name}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.anvay.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.anvay.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
  depends_on              = [google_project_service.apis]
}

# ── GKE ───────────────────────────────────────────────────────────────────────

module "gke" {
  source  = "terraform-google-modules/kubernetes-engine/google"
  version = "~> 30.0"

  project_id = var.gcp_project_id
  name       = local.name
  region     = var.gcp_region
  zones      = var.gcp_zones

  network           = google_compute_network.anvay.name
  subnetwork        = google_compute_subnetwork.anvay.name
  ip_range_pods     = "pods"
  ip_range_services = "services"

  kubernetes_version       = var.k8s_version
  release_channel          = "REGULAR"
  remove_default_node_pool = true

  node_pools = [{
    name               = "anvay-pool"
    machine_type       = var.node_machine_type
    min_count          = var.node_min_count
    max_count          = var.node_max_count
    initial_node_count = var.node_desired_count
    disk_size_gb       = 50
    disk_type          = "pd-ssd"
    auto_repair        = true
    auto_upgrade       = true
  }]

  depends_on = [google_project_service.apis]
}

# ── Cloud SQL (PostgreSQL 16) ─────────────────────────────────────────────────

resource "google_sql_database_instance" "anvay" {
  name             = local.name
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier              = var.db_tier
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    disk_size         = var.db_disk_gb

    backup_configuration {
      enabled    = true
      start_time = "03:00"
      backup_retention_settings {
        retained_backups = var.environment == "prod" ? 7 : 1
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.anvay.id
    }

    database_flags {
      name  = "cloudsql.enable_pg_cron"
      value = "on"
    }
  }

  deletion_protection = var.environment == "prod"
  depends_on          = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "anvay" {
  name     = "anvay"
  instance = google_sql_database_instance.anvay.name
}

resource "google_sql_user" "anvay" {
  name     = "anvay"
  instance = google_sql_database_instance.anvay.name
  password = var.postgres_password
}

# ── Memorystore (Redis) ───────────────────────────────────────────────────────

resource "google_redis_instance" "anvay" {
  name           = local.name
  tier           = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.redis_memory_gb
  region         = var.gcp_region

  authorized_network = google_compute_network.anvay.id

  redis_version     = "REDIS_7_0"
  display_name      = "Anvay Redis"
  connect_mode      = "PRIVATE_SERVICE_ACCESS"
  reserved_ip_range = google_compute_global_address.private_ip_range.name

  depends_on = [google_service_networking_connection.private_vpc]
}

# ── Neo4j on GKE ──────────────────────────────────────────────────────────────

resource "kubernetes_persistent_volume_claim" "neo4j" {
  metadata {
    name      = "neo4j-data"
    namespace = module.anvay_app.namespace
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "standard"

    resources {
      requests = { storage = "20Gi" }
    }
  }
}

resource "kubernetes_deployment" "neo4j" {
  metadata {
    name      = "neo4j"
    namespace = module.anvay_app.namespace
    labels    = { app = "neo4j" }
  }

  spec {
    replicas = 1

    selector {
      match_labels = { app = "neo4j" }
    }

    template {
      metadata { labels = { app = "neo4j" } }

      spec {
        container {
          name  = "neo4j"
          image = "neo4j:5-community"

          env { name = "NEO4J_AUTH"; value = "neo4j/${var.neo4j_password}" }
          env { name = "NEO4J_PLUGINS"; value = "[\"apoc\"]" }

          port { container_port = 7474 }
          port { container_port = 7687 }

          volume_mount { name = "data"; mount_path = "/data" }
        }

        volume {
          name = "data"
          persistent_volume_claim { claim_name = kubernetes_persistent_volume_claim.neo4j.metadata[0].name }
        }
      }
    }
  }

  depends_on = [module.anvay_app]
}

resource "kubernetes_service" "neo4j" {
  metadata {
    name      = "neo4j"
    namespace = module.anvay_app.namespace
  }

  spec {
    selector = { app = "neo4j" }
    type     = "ClusterIP"

    port { name = "http"; port = 7474; target_port = 7474 }
    port { name = "bolt"; port = 7687; target_port = 7687 }
  }
}

# ── Anvay App (Helm) ──────────────────────────────────────────────────────────

module "anvay_app" {
  source = "../../modules/anvay-helm"

  namespace   = "anvay"
  environment = var.environment

  jwt_secret     = var.jwt_secret
  encryption_key = var.encryption_key

  database_url   = "postgresql://anvay:${var.postgres_password}@${google_sql_database_instance.anvay.private_ip_address}:5432/anvay"
  redis_url      = "redis://${google_redis_instance.anvay.host}:6379"
  neo4j_uri      = "bolt://neo4j:7687"
  neo4j_password = var.neo4j_password

  gateway_image    = var.gateway_image
  web_image        = var.web_image
  gateway_replicas = var.gateway_replicas
  web_replicas     = var.web_replicas

  ingress_enabled = true
  ingress_class   = "gce"
  app_hostname    = var.app_hostname
  tls_secret_name = var.tls_secret_name

  depends_on = [
    module.gke,
    google_sql_database_instance.anvay,
    google_redis_instance.anvay,
  ]
}
