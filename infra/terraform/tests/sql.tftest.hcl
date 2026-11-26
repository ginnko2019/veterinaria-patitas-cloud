# Pruebas de limites de configuracion: no requieren Azure ni crean recursos.
mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id = "11111111-1111-4111-8111-111111111111"
    }
  }
}

variables {
  environment = "dev"
  location    = "eastus2"
  name_suffix = "sqltest"
}

run "sql_disabled_by_default" {
  command = plan

  assert {
    condition = (
      length(azurerm_mssql_server.dev) == 0 &&
      length(azurerm_mssql_database.dev) == 0 &&
      length(azurerm_mssql_firewall_rule.dev) == 0
    )
    error_message = "La configuracion por defecto no debe crear ni exponer recursos SQL."
  }

  assert {
    condition = alltrue([
      for key in ["SQL_SERVER_FQDN", "SQL_DATABASE_NAME", "SQL_AUTH_MODE"] :
      !contains(keys(azurerm_linux_function_app.api.app_settings), key)
    ])
    error_message = "La API no debe recibir configuracion SQL mientras SQL este apagado."
  }

  assert {
    condition     = output.sql_server_fqdn == null && output.sql_database_name == null
    error_message = "Los outputs SQL deben ser null cuando no existe la base de datos."
  }
}

run "dev_sql_uses_entra_and_explicit_ips" {
  command = plan

  variables {
    sql_enabled               = true
    sql_entra_admin_name      = "patitas-sql-test-admins"
    sql_entra_admin_object_id = "22222222-2222-4222-8222-222222222222"
    sql_firewall_ipv4 = {
      development = "198.51.100.10"
      function    = "203.0.113.20"
    }
  }

  assert {
    condition = (
      length(azurerm_mssql_server.dev) == 1 &&
      length(azurerm_mssql_database.dev) == 1
    )
    error_message = "Habilitar SQL en DEV debe crear exactamente un servidor y una base."
  }

  assert {
    condition = (
      azurerm_mssql_server.dev[0].azuread_administrator[0].azuread_authentication_only &&
      azurerm_mssql_server.dev[0].azuread_administrator[0].object_id == var.sql_entra_admin_object_id &&
      azurerm_mssql_server.dev[0].azuread_administrator[0].login_username == var.sql_entra_admin_name &&
      azurerm_mssql_server.dev[0].azuread_administrator[0].tenant_id == data.azurerm_client_config.current[0].tenant_id &&
      azurerm_mssql_server.dev[0].administrator_login_password == null
    )
    error_message = "SQL debe usar exclusivamente el administrador Entra indicado, en el tenant actual y sin password SQL."
  }

  assert {
    condition = (
      azurerm_mssql_server.dev[0].minimum_tls_version == "1.2" &&
      azurerm_mssql_server.dev[0].connection_policy == "Proxy" &&
      azurerm_mssql_server.dev[0].public_network_access_enabled
    )
    error_message = "El acceso DEV previsto requiere TLS 1.2 y Proxy, limitado por las reglas IPv4 explicitas."
  }

  assert {
    condition = (
      azurerm_mssql_database.dev[0].sku_name == "Basic" &&
      azurerm_mssql_database.dev[0].max_size_gb == 2 &&
      azurerm_mssql_database.dev[0].storage_account_type == "Local"
    )
    error_message = "La base DEV debe mantener el limite de capacidad y SKU Basic acordados."
  }

  assert {
    condition = (
      azurerm_mssql_database.dev[0].transparent_data_encryption_enabled &&
      azurerm_mssql_database.dev[0].short_term_retention_policy[0].retention_days == 7
    )
    error_message = "La base DEV debe conservar cifrado TDE y siete dias de retencion."
  }

  assert {
    condition = (
      length(azurerm_mssql_firewall_rule.dev) == length(var.sql_firewall_ipv4) &&
      alltrue([
        for name, rule in azurerm_mssql_firewall_rule.dev :
        rule.start_ip_address == var.sql_firewall_ipv4[name] &&
        rule.end_ip_address == var.sql_firewall_ipv4[name] &&
        rule.start_ip_address != "0.0.0.0"
      ])
    )
    error_message = "El firewall solo debe permitir cada IPv4 aprobada, sin rangos ni apertura general a Azure."
  }

  # El FQDN lo calcula Azure y sigue siendo desconocido en un plan de Terraform
  # 1.10. Se verifica la clave; no se sustituye su valor por una respuesta falsa.
  assert {
    condition = (
      contains(keys(azurerm_linux_function_app.api.app_settings), "SQL_SERVER_FQDN") &&
      azurerm_linux_function_app.api.app_settings["SQL_DATABASE_NAME"] == azurerm_mssql_database.dev[0].name &&
      azurerm_linux_function_app.api.app_settings["SQL_AUTH_MODE"] == "managed-identity" &&
      azurerm_linux_function_app.api.identity[0].type == "SystemAssigned"
    )
    error_message = "La API debe recibir el servidor y la base SQL con autenticacion mediante identidad administrada."
  }
}

run "reject_sql_in_prod" {
  command = plan

  variables {
    environment               = "prod"
    sql_enabled               = true
    sql_entra_admin_name      = "patitas-sql-test-admins"
    sql_entra_admin_object_id = "22222222-2222-4222-8222-222222222222"
  }

  expect_failures = [var.sql_enabled]
}

run "reject_allow_all_azure_firewall_rule" {
  command = plan

  variables {
    sql_enabled               = true
    sql_entra_admin_name      = "patitas-sql-test-admins"
    sql_entra_admin_object_id = "22222222-2222-4222-8222-222222222222"
    sql_firewall_ipv4 = {
      allow-all-azure = "0.0.0.0"
    }
  }

  expect_failures = [var.sql_firewall_ipv4]
}

run "reject_missing_entra_administrator" {
  command = plan

  variables {
    sql_enabled = true
  }

  expect_failures = [
    var.sql_entra_admin_name,
    var.sql_entra_admin_object_id,
  ]
}

run "reject_placeholder_admin_id" {
  command = plan

  variables {
    sql_enabled               = true
    sql_entra_admin_name      = "patitas-sql-test-admins"
    sql_entra_admin_object_id = "00000000-0000-0000-0000-000000000000"
  }

  expect_failures = [var.sql_entra_admin_object_id]
}
