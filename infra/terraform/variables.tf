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

variable "name_suffix" {
  description = "Sufijo alfanumerico globalmente unico para Storage, Functions y SWA."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{4,10}$", var.name_suffix))
    error_message = "El sufijo debe tener entre 4 y 10 caracteres minusculos o digitos."
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
