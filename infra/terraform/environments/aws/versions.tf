terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  # Uncomment to store state in S3
  # backend "s3" {
  #   bucket         = "anway-terraform-state"
  #   key            = "aws/terraform.tfstate"
  #   region         = var.aws_region
  #   encrypt        = true
  #   dynamodb_table = "anway-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      App         = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# EKS cluster auth — populated after cluster creation
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  token                  = data.aws_eks_cluster_auth.anway.token
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    token                  = data.aws_eks_cluster_auth.anway.token
  }
}

data "aws_eks_cluster_auth" "anway" {
  name = module.eks.cluster_name
}
