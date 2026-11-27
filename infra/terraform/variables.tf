variable "environment" {
  description = "Nombre del ambiente: dev o prod."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "El ambiente debe ser dev o prod."
  }
}

variable "location" {
  description = "Region de Azure permitida por la suscripcion."
  type        = string
  default     = "eastus2"
}

variable "runtime_location" {
  description = "Region opcional de Functions y SQL. Vacia mantiene la region original de los recursos."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = var.runtime_location == "" || can(regex("^[a-z0-9]+$", var.runtime_location))
    error_message = "runtime_location debe ser un nombre corto de region Azure sin espacios, o vacio."
  }
}

variable "name_suffix" {
  description = "Sufijo alfanumerico globalmente unico para Storage, Functions y SWA."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{4,10}$", var.name_suffix))
    error_message = "El sufijo debe tener entre 4 y 10 caracteres minusculos o digitos."
  }
}

variable "resource_group_import_id" {
  description = "ID ARM del grupo precreado durante el bootstrap. Vacio conserva la creacion normal."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition = (
      var.resource_group_import_id == "" ||
      can(regex(
        "^/subscriptions/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/resourceGroups/rg-patitas-${var.environment}$",
        var.resource_group_import_id
      ))
    )
    error_message = "El ID debe apuntar a /subscriptions/<GUID>/resourceGroups/rg-patitas-<environment>, o estar vacio."
  }
}

variable "tags" {
  description = "Etiquetas institucionales comunes."
  type        = map(string)
  default = {
    proyecto = "veterinaria-patitas"
    curso    = "pemu-2026"
    gestion  = "terraform"
  }
}
