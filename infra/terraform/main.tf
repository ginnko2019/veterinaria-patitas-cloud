locals {
  prefix = "patitas-${var.environment}"

  common_tags = merge(var.tags, {
    ambiente = var.environment
  })
}

resource "azurerm_resource_group" "patitas" {
  name     = "rg-${local.prefix}"
  location = var.location
  tags     = local.common_tags
}

# Almacenamiento operativo de Azure Functions (no es almacenamiento de citas).
resource "azurerm_storage_account" "functions" {
  name                            = "stpat${var.environment}${var.name_suffix}"
  resource_group_name             = azurerm_resource_group.patitas.name
  location                        = azurerm_resource_group.patitas.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false

  tags = local.common_tags
}

resource "azurerm_log_analytics_workspace" "patitas" {
  name                = "log-${local.prefix}"
  resource_group_name = azurerm_resource_group.patitas.name
  location            = azurerm_resource_group.patitas.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.common_tags
}

resource "azurerm_application_insights" "api" {
  name                = "appi-${local.prefix}"
  resource_group_name = azurerm_resource_group.patitas.name
  location            = azurerm_resource_group.patitas.location
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.patitas.id
  tags                = local.common_tags
}

# Node 22 es compatible con Azure Functions Linux Consumption.
# Cuando migremos a Flex Consumption se revisara el plan y runtime.
resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.prefix}"
  resource_group_name = azurerm_resource_group.patitas.name
  location            = azurerm_resource_group.patitas.location
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = local.common_tags
}

resource "azurerm_linux_function_app" "api" {
  name                = "func-${local.prefix}-${var.name_suffix}"
  resource_group_name = azurerm_resource_group.patitas.name
  location            = azurerm_resource_group.patitas.location
  service_plan_id     = azurerm_service_plan.functions.id

  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  https_only                  = true
  functions_extension_version = "~4"

  identity {
    type = "SystemAssigned"
  }

  site_config {
    application_stack {
      node_version = "22"
    }

    application_insights_connection_string = azurerm_application_insights.api.connection_string
  }

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME" = "node"
    "WEBSITE_RUN_FROM_PACKAGE" = "1"
  }

  # No configurar auth_settings_v2 directamente: el registro SWA aplica
  # la configuracion Azure Static Web Apps AuthV2.
  tags = local.common_tags
}

resource "azurerm_static_web_app" "web" {
  name                         = "swa-${local.prefix}-${var.name_suffix}"
  resource_group_name          = azurerm_resource_group.patitas.name
  location                     = azurerm_resource_group.patitas.location
  sku_tier                     = "Standard"
  sku_size                     = "Standard"
  preview_environments_enabled = false
  tags                         = local.common_tags
}

# Link seguro solo cuando se active y compruebe que Azure bloquea
# peticiones DIRECTAS a la Function con una identidad falsificada.
resource "azurerm_static_web_app_function_app_registration" "backend" {
  static_web_app_id = azurerm_static_web_app.web.id
  function_app_id   = azurerm_linux_function_app.api.id
}
