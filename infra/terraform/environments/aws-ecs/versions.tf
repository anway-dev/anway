terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # backend "s3" {
  #   bucket         = "anway-terraform-state"
  #   key            = "aws-ecs/terraform.tfstate"
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
