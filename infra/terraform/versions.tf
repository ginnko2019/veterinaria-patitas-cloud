terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # DEV y PROD deben utilizar claves de estado distintas; el bootstrap de
  # Storage y OIDC se realiza una sola vez, antes del primer despliegue.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}
