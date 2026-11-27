output "resource_group_name" {
  description = "Grupo de recursos del ambiente."
  value       = azurerm_resource_group.patitas.name
}

output "static_web_app_url" {
  description = "URL HTTPS del frontend."
  value       = "https://${azurerm_static_web_app.web.default_host_name}"
}

output "function_app_name" {
  description = "Nombre de la API Azure Functions para el pipeline de despliegue."
  value       = azurerm_linux_function_app.api.name
}

output "static_web_app_name" {
  description = "Nombre del frontend para el pipeline de despliegue."
  value       = azurerm_static_web_app.web.name
}

output "app_insights_name" {
  description = "Recurso de observabilidad de la API."
  value       = azurerm_application_insights.api.name
}
