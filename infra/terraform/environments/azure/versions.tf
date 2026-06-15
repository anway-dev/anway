terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.97"
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

  # backend "azurerm" {
  #   resource_group_name  = "anvay-tfstate"
  #   storage_account_name = "anvayterraformstate"
  #   container_name       = "tfstate"
  #   key                  = "prod.terraform.tfstate"
  # }
}

provider "azurerm" {
  features {
    resource_group { prevent_deletion_if_contains_resources = false }
    key_vault { purge_soft_delete_on_destroy = true }
  }
  subscription_id = var.subscription_id
}

provider "kubernetes" {
  host                   = azurerm_kubernetes_cluster.anvay.kube_config[0].host
  client_certificate     = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].client_certificate)
  client_key             = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].client_key)
  cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = azurerm_kubernetes_cluster.anvay.kube_config[0].host
    client_certificate     = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].client_certificate)
    client_key             = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].client_key)
    cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.anvay.kube_config[0].cluster_ca_certificate)
  }
}
