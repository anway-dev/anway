locals {
  name = "${var.app_name}-demo"

  db_user     = "anway"
  db_name     = "anway"
  db_host     = "postgres"
  redis_host  = "redis"
  neo4j_host  = "neo4j"

  database_url = "postgresql://${local.db_user}:${var.postgres_password}@${local.db_host}:5432/${local.db_name}"
  redis_url    = "redis://${local.redis_host}:6379"
  neo4j_uri    = "bolt://${local.neo4j_host}:7687"
}

# ── Network ──────────────────────────────────────────────────────────────────

resource "docker_network" "anway" {
  name = local.name
}

# ── Images ───────────────────────────────────────────────────────────────────

resource "docker_image" "postgres" {
  name         = "pgvector/pgvector:pg16"
  keep_locally = true
}

resource "docker_image" "redis" {
  name         = "redis:7-alpine"
  keep_locally = true
}

resource "docker_image" "neo4j" {
  name         = "neo4j:5-community"
  keep_locally = true
}

resource "docker_image" "gateway" {
  name         = var.gateway_image
  keep_locally = true
}

resource "docker_image" "web" {
  name         = var.web_image
  keep_locally = true
}

# ── Volumes ───────────────────────────────────────────────────────────────────

resource "docker_volume" "postgres" {
  name = "${local.name}-postgres"
}

resource "docker_volume" "redis" {
  name = "${local.name}-redis"
}

resource "docker_volume" "neo4j" {
  name = "${local.name}-neo4j"
}

# ── Postgres ─────────────────────────────────────────────────────────────────

resource "docker_container" "postgres" {
  name  = "${local.name}-postgres"
  image = docker_image.postgres.image_id

  networks_advanced {
    name    = docker_network.anway.name
    aliases = ["postgres"]
  }

  ports {
    internal = 5432
    external = var.postgres_host_port
  }

  env = [
    "POSTGRES_USER=${local.db_user}",
    "POSTGRES_PASSWORD=${var.postgres_password}",
    "POSTGRES_DB=${local.db_name}",
  ]

  volumes {
    volume_name    = docker_volume.postgres.name
    container_path = "/var/lib/postgresql/data"
  }

  healthcheck {
    test         = ["CMD-SHELL", "pg_isready -U ${local.db_user}"]
    interval     = "5s"
    timeout      = "5s"
    retries      = 10
    start_period = "5s"
  }

  restart = "unless-stopped"
}

# ── Redis ─────────────────────────────────────────────────────────────────────

resource "docker_container" "redis" {
  name  = "${local.name}-redis"
  image = docker_image.redis.image_id

  networks_advanced {
    name    = docker_network.anway.name
    aliases = ["redis"]
  }

  ports {
    internal = 6379
    external = var.redis_host_port
  }

  volumes {
    volume_name    = docker_volume.redis.name
    container_path = "/data"
  }

  healthcheck {
    test     = ["CMD", "redis-cli", "ping"]
    interval = "5s"
    timeout  = "5s"
    retries  = 10
  }

  restart = "unless-stopped"
}

# ── Neo4j ─────────────────────────────────────────────────────────────────────

resource "docker_container" "neo4j" {
  name  = "${local.name}-neo4j"
  image = docker_image.neo4j.image_id

  networks_advanced {
    name    = docker_network.anway.name
    aliases = ["neo4j"]
  }

  ports {
    internal = 7474
    external = var.neo4j_http_port
  }

  ports {
    internal = 7687
    external = var.neo4j_bolt_port
  }

  env = [
    "NEO4J_AUTH=neo4j/${var.neo4j_password}",
    "NEO4J_PLUGINS=[\"apoc\"]",
  ]

  volumes {
    volume_name    = docker_volume.neo4j.name
    container_path = "/data"
  }

  healthcheck {
    test     = ["CMD-SHELL", "wget -q --spider http://localhost:7474 || exit 1"]
    interval = "10s"
    timeout  = "10s"
    retries  = 12
  }

  restart = "unless-stopped"
}

# ── Gateway ────────────────────────────────────────────────────────────────────

resource "docker_container" "gateway" {
  name  = "${local.name}-gateway"
  image = docker_image.gateway.image_id

  networks_advanced {
    name    = docker_network.anway.name
    aliases = ["gateway"]
  }

  ports {
    internal = 4000
    external = var.gateway_host_port
  }

  env = [
    "NODE_ENV=production",
    "PORT=4000",
    "HOST=0.0.0.0",
    "DATABASE_URL=${local.database_url}",
    "REDIS_URL=${local.redis_url}",
    "JWT_SECRET=${var.jwt_secret}",
    "ANWAY_ENCRYPTION_KEY=${var.encryption_key}",
    "NEO4J_URI=${local.neo4j_uri}",
    "NEO4J_USER=neo4j",
    "NEO4J_PASSWORD=${var.neo4j_password}",
  ]

  depends_on = [
    docker_container.postgres,
    docker_container.redis,
    docker_container.neo4j,
  ]

  restart = "unless-stopped"
}

# ── Web ────────────────────────────────────────────────────────────────────────

resource "docker_container" "web" {
  name  = "${local.name}-web"
  image = docker_image.web.image_id

  networks_advanced {
    name    = docker_network.anway.name
    aliases = ["web"]
  }

  ports {
    internal = 3000
    external = var.web_host_port
  }

  env = [
    "NODE_ENV=production",
    "GATEWAY_URL=http://gateway:4000",
    "DEMO_EMAIL=admin@anway.local",
    "DEMO_TENANT_ID=00000000-0000-0000-0000-000000000001",
  ]

  depends_on = [docker_container.gateway]

  restart = "unless-stopped"
}
