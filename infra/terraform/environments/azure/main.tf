locals {
  name     = "${var.app_name}-${var.environment}"
  location = var.azure_location
}

# ── Resource Group ────────────────────────────────────────────────────────────

resource "azurerm_resource_group" "anvay" {
  name     = local.name
  location = local.location

  tags = {
    App         = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── Virtual Network ───────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "anvay" {
  name                = local.name
  address_space       = [var.vnet_cidr]
  location            = azurerm_resource_group.anvay.location
  resource_group_name = azurerm_resource_group.anvay.name
}

resource "azurerm_subnet" "aks" {
  name                 = "aks-nodes"
  resource_group_name  = azurerm_resource_group.anvay.name
  virtual_network_name = azurerm_virtual_network.anvay.name
  address_prefixes     = [var.aks_subnet_cidr]
}

resource "azurerm_subnet" "db" {
  name                 = "databases"
  resource_group_name  = azurerm_resource_group.anvay.name
  virtual_network_name = azurerm_virtual_network.anvay.name
  address_prefixes     = [var.db_subnet_cidr]

  delegation {
    name = "postgres-delegation"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.name}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.anvay.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "${local.name}-postgres"
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  resource_group_name   = azurerm_resource_group.anvay.name
  virtual_network_id    = azurerm_virtual_network.anvay.id
}

# ── AKS ───────────────────────────────────────────────────────────────────────

resource "azurerm_kubernetes_cluster" "anvay" {
  name                = local.name
  location            = azurerm_resource_group.anvay.location
  resource_group_name = azurerm_resource_group.anvay.name
  dns_prefix          = local.name

  kubernetes_version = var.k8s_version

  default_node_pool {
    name           = "system"
    node_count     = var.node_desired_count
    vm_size        = var.node_vm_size
    vnet_subnet_id = azurerm_subnet.aks.id

    enable_auto_scaling = true
    min_count           = var.node_min_count
    max_count           = var.node_max_count

    os_disk_size_gb = 50
    os_disk_type    = "Managed"
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "azure"
    load_balancer_sku = "standard"
  }

  tags = azurerm_resource_group.anvay.tags
}

# ── Azure Database for PostgreSQL Flexible Server ─────────────────────────────

resource "azurerm_postgresql_flexible_server" "anvay" {
  name                   = local.name
  resource_group_name    = azurerm_resource_group.anvay.name
  location               = azurerm_resource_group.anvay.location
  version                = "16"
  administrator_login    = "anvay"
  administrator_password = var.postgres_password

  storage_mb   = var.db_storage_mb
  storage_tier = "P4"
  sku_name     = var.db_sku_name

  delegated_subnet_id    = azurerm_subnet.db.id
  private_dns_zone_id    = azurerm_private_dns_zone.postgres.id

  backup_retention_days        = var.environment == "prod" ? 7 : 1
  geo_redundant_backup_enabled = var.environment == "prod"
  zone                         = "1"

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

resource "azurerm_postgresql_flexible_server_database" "anvay" {
  name      = "anvay"
  server_id = azurerm_postgresql_flexible_server.anvay.id
  collation = "en_US.utf8"
  charset   = "utf8"
}

resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.anvay.id
  value     = "VECTOR,PG_STAT_STATEMENTS,AGE"
}

# ── Azure Cache for Redis ─────────────────────────────────────────────────────

resource "azurerm_redis_cache" "anvay" {
  name                = local.name
  location            = azurerm_resource_group.anvay.location
  resource_group_name = azurerm_resource_group.anvay.name
  capacity            = var.redis_capacity
  family              = var.redis_family
  sku_name            = var.redis_sku

  enable_non_ssl_port = false
  minimum_tls_version = "1.2"

  redis_configuration {
    maxmemory_policy = "allkeys-lru"
  }

  tags = azurerm_resource_group.anvay.tags
}

# ── Neo4j on AKS ─────────────────────────────────────────────────────────────

resource "kubernetes_persistent_volume_claim" "neo4j" {
  metadata {
    name      = "neo4j-data"
    namespace = module.anvay_app.namespace
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "managed-premium"

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

    selector { match_labels = { app = "neo4j" } }

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

  database_url   = "postgresql://anvay:${var.postgres_password}@${azurerm_postgresql_flexible_server.anvay.fqdn}:5432/anvay?sslmode=require"
  redis_url      = "rediss://:${azurerm_redis_cache.anvay.primary_access_key}@${azurerm_redis_cache.anvay.hostname}:6380"
  neo4j_uri      = "bolt://neo4j:7687"
  neo4j_password = var.neo4j_password

  gateway_image    = var.gateway_image
  web_image        = var.web_image
  gateway_replicas = var.gateway_replicas
  web_replicas     = var.web_replicas

  ingress_enabled = true
  ingress_class   = "azure/application-gateway"
  app_hostname    = var.app_hostname
  tls_secret_name = var.tls_secret_name

  depends_on = [
    azurerm_kubernetes_cluster.anvay,
    azurerm_postgresql_flexible_server.anvay,
    azurerm_redis_cache.anvay,
  ]
}
