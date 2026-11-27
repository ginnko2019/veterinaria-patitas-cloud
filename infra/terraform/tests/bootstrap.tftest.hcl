# Limites de adopcion del grupo precreado: sin credenciales ni llamadas a Azure.
mock_provider "azurerm" {}

variables {
  environment = "dev"
  location    = "eastus2"
  name_suffix = "bootstrap"
}

run "adopt_precreated_dev_resource_group" {
  command = plan

  variables {
    resource_group_import_id = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-patitas-dev"
  }

  # El mock generico no importa recursos. Limitar este override al caso positivo
  # conserva el rechazo de imports accidentales en las demas pruebas.
  override_resource {
    target = azurerm_resource_group.patitas
    values = {
      id       = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-patitas-dev"
      name     = "rg-patitas-dev"
      location = "eastus2"
      tags = {
        proyecto = "veterinaria-patitas"
        curso    = "pemu-2026"
        gestion  = "terraform"
        ambiente = "dev"
      }
    }
  }

  assert {
    condition = (
      azurerm_resource_group.patitas.id == var.resource_group_import_id &&
      azurerm_resource_group.patitas.name == "rg-patitas-dev" &&
      azurerm_linux_function_app.api.resource_group_name == "rg-patitas-dev"
    )
    error_message = "La adopcion debe conservar la direccion singular del grupo DEV y el destino de la Function."
  }
}

run "reject_resource_group_from_other_environment" {
  command = plan

  variables {
    resource_group_import_id = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-patitas-prod"
  }

  expect_failures = [var.resource_group_import_id]
}

run "reject_resource_group_subscription_without_guid" {
  command = plan

  variables {
    resource_group_import_id = "/subscriptions/not-a-guid/resourceGroups/rg-patitas-dev"
  }

  expect_failures = [var.resource_group_import_id]
}

run "separate_backend_region_without_moving_existing_resources" {
  command = plan

  variables {
    runtime_location = "westcentralus"
  }

  assert {
    condition = (
      azurerm_resource_group.patitas.location == "eastus2" &&
      azurerm_storage_account.functions.location == "eastus2" &&
      azurerm_static_web_app.web.location == "eastus2" &&
      azurerm_log_analytics_workspace.patitas.location == "eastus2" &&
      azurerm_service_plan.functions.location == "westcentralus" &&
      azurerm_linux_function_app.api.location == "westcentralus"
    )
    error_message = "La region alternativa solo debe mover el plan y la API; los recursos existentes permanecen en eastus2."
  }
}

run "reject_invalid_runtime_location" {
  command = plan

  variables {
    runtime_location = "West Central US"
  }

  expect_failures = [var.runtime_location]
}
