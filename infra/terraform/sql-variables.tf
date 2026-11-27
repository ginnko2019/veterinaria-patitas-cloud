variable "sql_enabled" {
  description = "Habilita la base SQL de desarrollo; este incremento no permite SQL en prod."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.sql_enabled || var.environment == "dev"
    error_message = "SQL solo puede habilitarse en el ambiente dev."
  }
}

variable "sql_entra_admin_name" {
  description = "Nombre del usuario o grupo Entra que administrara SQL; requerido al habilitar SQL."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = !var.sql_enabled || length(trimspace(var.sql_entra_admin_name)) > 0
    error_message = "Configurar sql_entra_admin_name antes de habilitar SQL."
  }
}

variable "sql_entra_admin_object_id" {
  description = "Object ID del administrador Entra en el tenant de la suscripcion, no su client ID."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition = !var.sql_enabled || (
      can(regex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        var.sql_entra_admin_object_id
      )) && var.sql_entra_admin_object_id != "00000000-0000-0000-0000-000000000000"
    )
    error_message = "Configurar sql_entra_admin_object_id con un GUID valido antes de habilitar SQL."
  }
}

variable "sql_firewall_ipv4" {
  description = "Mapa nombre de regla => IPv4 individual revisada; vacio cierra el acceso a SQL."
  type        = map(string)
  default     = {}
  nullable    = false

  validation {
    condition = alltrue([
      for name in keys(var.sql_firewall_ipv4) : can(regex("^[a-zA-Z0-9-]+$", name))
    ])
    error_message = "Los nombres de reglas SQL solo pueden contener letras, digitos y guiones."
  }

  validation {
    condition = alltrue([
      for address in values(var.sql_firewall_ipv4) :
      can(cidrnetmask("${address}/32")) && address != "0.0.0.0"
    ])
    error_message = "Cada regla requiere una IPv4 individual valida; no se permite 0.0.0.0 ni rangos CIDR."
  }
}
