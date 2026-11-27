locals {
  prefix           = "patitas-${var.environment}"
  runtime_location = var.runtime_location != "" ? var.runtime_location : var.location
  sql_server_name  = "sql-${local.prefix}-${var.name_suffix}${local.runtime_location != var.location ? "-${local.runtime_location}" : ""}"

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
  location            = local.runtime_location
  os_type             = "Linux"
  sku_name            = "Y1"
  tags                = local.common_tags
}

resource "azurerm_linux_function_app" "api" {
  name                = "func-${local.prefix}-${var.name_suffix}"
  resource_group_name = azurerm_resource_group.patitas.name
  location            = local.runtime_location
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

  app_settings = merge(
    {
      "FUNCTIONS_WORKER_RUNTIME" = "node"
      "TRUST_SWA_PRINCIPAL"      = "false"
      "APP_ENV"                  = var.environment
    },
    var.sql_enabled ? {
      "PERSISTENCE"       = "sql"
      "SQL_SERVER_FQDN"   = azurerm_mssql_server.dev[0].fully_qualified_domain_name
      "SQL_DATABASE_NAME" = azurerm_mssql_database.dev[0].name
      "SQL_AUTH_MODE"     = "managed-identity"
    } : {}
  )

  # Linux Consumption ejecuta la URL del ZIP que publica el workflow de la API.
  # El registro SWA administra AuthV2. Conservar ambos valores para que un
  # apply posterior no retire el paquete ni revierta la autenticacion vinculada.
  lifecycle {
    ignore_changes = [
      auth_settings_v2,
      app_settings["WEBSITE_RUN_FROM_PACKAGE"],
    ]
  }

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

  # La publicacion real del frontend puede asociar este sitio con su repositorio.
  # Terraform administra el sitio, pero no debe borrar la asociacion existente.
  lifecycle {
    ignore_changes = [repository_url, repository_branch]
  }
}

# Esta asociacion configura AuthV2 en la Function al aplicar la infraestructura.
# Antes de publicar citas, verificar que rechaza peticiones DIRECTAS falsificadas.
resource "azurerm_static_web_app_function_app_registration" "backend" {
  static_web_app_id = azurerm_static_web_app.web.id
  function_app_id   = azurerm_linux_function_app.api.id
}
