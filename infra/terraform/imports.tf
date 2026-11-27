# Adoptar el grupo existente permite limitar Contributor a ese grupo desde el
# primer despliegue. El import se muestra en plan y se registra solo en apply.
# Las ejecuciones posteriores no repiten el import si ya esta en el estado.
import {
  for_each = var.resource_group_import_id == "" ? {} : { bootstrap = var.resource_group_import_id }

  to = azurerm_resource_group.patitas
  id = each.value
}
