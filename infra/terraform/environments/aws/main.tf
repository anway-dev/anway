locals {
  name = "${var.app_name}-${var.environment}"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = {
    App         = var.app_name
    Environment = var.environment
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# ── VPC ───────────────────────────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.5"

  name = local.name
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets  = [for i, az in local.azs : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "prod"
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# ── EKS ───────────────────────────────────────────────────────────────────────

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = local.name
  cluster_version = var.k8s_version

  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  cluster_endpoint_public_access = true

  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
    aws-ebs-csi-driver = { most_recent = true }
  }

  eks_managed_node_groups = {
    anvay = {
      instance_types = [var.node_instance_type]
      min_size       = var.node_min_count
      max_size       = var.node_max_count
      desired_size   = var.node_desired_count

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size = 50
            volume_type = "gp3"
          }
        }
      }
    }
  }

  tags = local.tags
}

# ── RDS (PostgreSQL with pgvector) ───────────────────────────────────────────

resource "aws_db_subnet_group" "anvay" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
  tags       = local.tags
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Allow EKS nodes to reach RDS"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  tags = local.tags
}

resource "aws_db_instance" "anvay" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "anvay"
  username = "anvay"
  password = var.postgres_password

  db_subnet_group_name   = aws_db_subnet_group.anvay.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  allocated_storage     = var.db_storage_gb
  max_allocated_storage = var.db_storage_gb * 4
  storage_type          = "gp3"
  storage_encrypted     = true

  backup_retention_period = var.environment == "prod" ? 7 : 1
  deletion_protection     = var.environment == "prod"
  skip_final_snapshot     = var.environment != "prod"
  multi_az                = var.environment == "prod" ? true : false

  # pgvector extension is installed via migration, not here
  parameter_group_name = aws_db_parameter_group.anvay.name

  tags = local.tags
}

resource "aws_db_parameter_group" "anvay" {
  name   = local.name
  family = "postgres16"

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  tags = local.tags
}

# ── ElastiCache (Redis) ────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "anvay" {
  name       = local.name
  subnet_ids = module.vpc.private_subnets
  tags       = local.tags
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Allow EKS nodes to reach ElastiCache"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }

  tags = local.tags
}

resource "aws_elasticache_replication_group" "anvay" {
  replication_group_id = local.name
  description          = "Anvay Redis cache"

  node_type          = var.redis_node_type
  num_cache_clusters = var.environment == "prod" ? 2 : 1
  port               = 6379

  subnet_group_name  = aws_elasticache_subnet_group.anvay.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = false  # Set true + add auth token for prod

  automatic_failover_enabled = var.environment == "prod"

  tags = local.tags
}

# ── Neo4j on EKS (self-managed, community edition) ────────────────────────────

resource "kubernetes_persistent_volume_claim" "neo4j" {
  metadata {
    name      = "neo4j-data"
    namespace = module.anvay_app.namespace
  }

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "gp2"

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
      metadata {
        labels = { app = "neo4j" }
      }

      spec {
        container {
          name  = "neo4j"
          image = "neo4j:5-community"

          env {
            name  = "NEO4J_AUTH"
            value = "neo4j/${var.neo4j_password}"
          }

          env {
            name  = "NEO4J_PLUGINS"
            value = "[\"apoc\"]"
          }

          port { container_port = 7474 }
          port { container_port = 7687 }

          volume_mount {
            name       = "neo4j-data"
            mount_path = "/data"
          }
        }

        volume {
          name = "neo4j-data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.neo4j.metadata[0].name
          }
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

    port {
      name        = "http"
      port        = 7474
      target_port = 7474
    }

    port {
      name        = "bolt"
      port        = 7687
      target_port = 7687
    }
  }
}

# ── Anvay App (Helm) ──────────────────────────────────────────────────────────

module "anvay_app" {
  source = "../../modules/anvay-helm"

  namespace   = "anvay"
  environment = var.environment

  jwt_secret     = var.jwt_secret
  encryption_key = var.encryption_key

  database_url   = "postgresql://anvay:${var.postgres_password}@${aws_db_instance.anvay.address}:5432/anvay"
  redis_url      = "redis://${aws_elasticache_replication_group.anvay.primary_endpoint_address}:6379"
  neo4j_uri      = "bolt://neo4j:7687"
  neo4j_password = var.neo4j_password

  gateway_image    = var.gateway_image
  web_image        = var.web_image
  gateway_replicas = var.gateway_replicas
  web_replicas     = var.web_replicas

  ingress_enabled = true
  ingress_class   = "alb"
  app_hostname    = var.app_hostname
  tls_secret_name = var.tls_secret_name

  depends_on = [
    module.eks,
    aws_db_instance.anvay,
    aws_elasticache_replication_group.anvay,
  ]
}
