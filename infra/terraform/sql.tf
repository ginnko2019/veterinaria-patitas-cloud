# Primera base de datos de desarrollo. SQL permanece apagado por defecto.
data "azurerm_client_config" "current" {
  count = var.sql_enabled ? 1 : 0
}

resource "azurerm_mssql_server" "dev" {
  count = var.sql_enabled ? 1 : 0

  name                          = local.sql_server_name
  resource_group_name           = azurerm_resource_group.patitas.name
  location                      = local.runtime_location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  connection_policy             = "Proxy"

  # La administracion usa Entra; no se crea una credencial SQL con password.
  azuread_administrator {
    login_username              = var.sql_entra_admin_name
    object_id                   = var.sql_entra_admin_object_id
    tenant_id                   = data.azurerm_client_config.current[0].tenant_id
    azuread_authentication_only = true
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = local.common_tags
}

resource "azurerm_mssql_database" "dev" {
  count = var.sql_enabled ? 1 : 0

  name                                = "patitas-dev"
  server_id                           = azurerm_mssql_server.dev[0].id
  sku_name                            = "Basic"
  max_size_gb                         = 2
  storage_account_type                = "Local"
  transparent_data_encryption_enabled = true

  short_term_retention_policy {
    retention_days = 7
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = local.common_tags
}

# Las claves se conocen durante plan. No iterar sobre IPs calculadas de Functions:
# durante la primera creacion Azure aun no ha asignado esas direcciones.
# Un mapa vacio mantiene cerrado el acceso publico a SQL.
resource "azurerm_mssql_firewall_rule" "dev" {
  for_each = var.sql_enabled ? var.sql_firewall_ipv4 : {}

  name             = each.key
  server_id        = azurerm_mssql_server.dev[0].id
  start_ip_address = each.value
  end_ip_address   = each.value
}
