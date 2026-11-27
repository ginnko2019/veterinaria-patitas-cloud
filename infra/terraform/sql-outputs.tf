output "sql_server_fqdn" {
  description = "Nombre DNS del servidor SQL DEV; null cuando SQL esta apagado."
  value       = var.sql_enabled ? azurerm_mssql_server.dev[0].fully_qualified_domain_name : null
}

output "sql_database_name" {
  description = "Nombre de la base SQL DEV; null cuando SQL esta apagado."
  value       = var.sql_enabled ? azurerm_mssql_database.dev[0].name : null
}

output "function_identity_principal_id" {
  description = "Object ID de la identidad administrada de la Function; es distinto de su client ID."
  value       = azurerm_linux_function_app.api.identity[0].principal_id
}

output "function_outbound_ip_addresses" {
  description = "IPs actuales de salida para revisar las reglas SQL; Consumption puede cambiarlas al escalar."
  value       = azurerm_linux_function_app.api.outbound_ip_address_list
}

output "function_possible_outbound_ip_addresses" {
  description = "IPs posibles reportadas por Azure; no garantizan una lista estable en Consumption."
  value       = azurerm_linux_function_app.api.possible_outbound_ip_address_list
}
