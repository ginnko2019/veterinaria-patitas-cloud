# Azure SQL DEV — Veterinaria Patitas

## Estado y alcance

Este incremento prepara el servidor y la base `patitas-dev` mediante Terraform. **Código publicado no significa base creada:** falta aplicar el plan en una sesión autorizada de Azure y comprobar la conexión. El [PR #11](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/11) ya implementa el repositorio SQL, la migración inicial y el mapeo de identidad del cliente; su integración, publicación y pruebas reales en Azure están pendientes. La memoria solo está habilitada en local/test. Con `sql_enabled=true`, Terraform selecciona `PERSISTENCE="sql"` y configura la conexión, pero no publica la API ni ejecuta migraciones. La confianza SWA permanece apagada durante esta preparación.

La elección de Basic se limita a desarrollo: 5 DTU, máximo 2 GB, cifrado TDE y retención de restauración a un punto en el tiempo de 7 días. El respaldo es local; no ofrece restauración geográfica. El costo regional, la capacidad y los objetivos de recuperación del ADR-002 siguen pendientes de validación real. PROD no acepta `sql_enabled=true` en este incremento.

## 1. Configuración necesaria

Completar primero el bootstrap de estado/OIDC del [README](README.md). Para ejecutar el workflow, configurar en **GitHub → Settings → Environments → dev → Variables**:

| Variable | Valor requerido |
| --- | --- |
| `SQL_ENABLED` | `true` para crear SQL DEV; si no existe, se utiliza `false`. |
| `SQL_ENTRA_ADMIN_NAME` | Nombre del usuario o grupo Entra que administrará la base. |
| `SQL_ENTRA_ADMIN_OBJECT_ID` | Object ID real de ese usuario o grupo en el tenant de la suscripción. |
| `SQL_FIREWALL_IPV4` | Objeto JSON con reglas por IPv4 individual; inicialmente `{}`. |

Estas variables son identificadores/configuración, no contraseñas. No utilizar como administrador SQL la identidad de la Function: su acceso de ejecución se otorga dentro de la base con permisos limitados.

Desde Azure Cloud Shell, los siguientes comandos son de consulta y permiten comprobar la suscripción y obtener los datos del usuario conectado cuando vaya a ser el administrador:

```bash
az account show --query '{subscription:name,subscriptionId:id,tenantId:tenantId}' --output json
az ad signed-in-user show --query '{adminName:userPrincipalName,adminObjectId:id}' --output json
```

Si se elige un grupo Entra, usar su nombre y object ID verificados en lugar de los del usuario. La identidad OIDC de Terraform requiere permisos para crear SQL y administrar `Microsoft.Sql/servers/azureADOnlyAuthentications/*` en el ámbito autorizado; los permisos de la aplicación para consultar datos son distintos.

## 2. Crear los recursos y revisar el plan

Con el incremento integrado y las variables configuradas, ejecutar **Infraestructura Terraform → environment=dev → operation=plan**. Revisar servidor, base, SKU y los demás recursos previstos antes de ejecutar `operation=apply`. El primer apply puede crear SQL con el firewall vacío: su endpoint existe, pero no autoriza conexiones de clientes todavía.

Para una ejecución local autorizada, copiar `environments/sql-dev.tfvars.example` a `sql-dev.tfvars.local`, sustituir el administrador y usarlo junto al ambiente:

```bash
terraform -chdir=infra/terraform plan \
  -var-file=environments/dev.tfvars \
  -var-file=sql-dev.tfvars.local \
  -var="name_suffix=$TF_NAME_SUFFIX" \
  -out=tfplan
```

El backend remoto debe estar inicializado antes, como explica el README. El archivo local y el plan están excluidos de Git. El workflow usa las variables del Environment; no carga este archivo local.

Servidor y base tienen `prevent_destroy`: cambiar `sql_enabled` a `false` después de crearlos produce un error al intentar eliminarlos. Ese flag sirve para habilitar el primer aprovisionamiento; no es una opción de pausa ni de ahorro de facturación.

## 3. Autorizar las IP revisadas

Después de crear la Function, consultar sus direcciones de salida usando su nombre real:

```bash
az functionapp show --resource-group rg-patitas-dev \
  --name '<nombre-real-de-la-function>' \
  --query '{actuales:outboundIpAddresses,posibles:possibleOutboundIpAddresses,principalId:identity.principalId}' \
  --output json
```

Configurar `SQL_FIREWALL_IPV4` con una clave por dirección revisada, por ejemplo `{"function-01":"<IPv4-real>","function-02":"<IPv4-real>"}`, y volver a ejecutar plan/apply. Añadir la IP pública del administrador solo durante el bootstrap y las migraciones. Cada regla admite una dirección exacta; no se permite `0.0.0.0`, CIDR ni intervalos. No se habilita “permitir todos los servicios de Azure”.

Se usa un mapa de entrada con claves conocidas antes del plan. Terraform no intenta crear reglas con `for_each` sobre las IP calculadas de una Function que aún no existe.

**Límite del plan Consumption Y1:** las IP pueden cambiar al escalar y la lista de IP posibles no es definitiva. Si aparece una nueva IP, SQL rechazará esa conexión hasta revisar y actualizar las reglas. Este diseño de DEV no demuestra conectividad estable de producción; esa etapa requiere revisar el plan de Functions y la red.

## 4. Contrato de ejecución con la API

Terraform agrega a la Function estas variables únicamente cuando SQL está habilitado:

| App setting | Contenido |
| --- | --- |
| `PERSISTENCE` | `sql`; selecciona el repositorio persistente de la API. |
| `SQL_SERVER_FQDN` | FQDN real del servidor SQL. |
| `SQL_DATABASE_NAME` | `patitas-dev`. |
| `SQL_AUTH_MODE` | `managed-identity`. |

Son el contrato de conexión que debe consumir la API SQL del PR #11 al integrarse. Con `sql_enabled=false`, Terraform omite los cuatro settings y no selecciona persistencia. La identidad administrada de sistema de la Function se autentica ante SQL. El usuario de SWA sigue determinando quién puede consultar o cancelar cada cita dentro del backend.

El PR #11 resuelve el `userId` de SWA mediante `Clientes.identity_id` y usa `Clientes.id` como clave interna para comprobar la propiedad de mascotas y citas. Al preparar los datos DEV, registrar el `userId` real de cada cliente en `identity_id` y verificar ese enlace con una sesión legítima. El client/application ID utilizado en el bootstrap identifica a la Function y no reemplaza la identidad de un cliente.

Los outputs `sql_server_fqdn`, `sql_database_name`, `function_identity_principal_id`, `function_outbound_ip_addresses` y `function_possible_outbound_ip_addresses` facilitan la configuración sin exponer credenciales. Los outputs SQL no tienen valor cuando SQL está deshabilitado.

La activación del usuario y rol SQL está separada del aprovisionamiento. Seguir [database/README.md](../../database/README.md), aplicar las migraciones integradas desde el PR #11 y ejecutar `database/bootstrap/runtime-user-dev.sql` como administrador Entra en la base correcta. Ese PR incorpora consultas parametrizadas, conexión con identidad administrada y un índice para impedir reservas activas duplicadas; comprobar su funcionamiento con los artefactos desplegados.

Antes de afirmar que la persistencia funciona, comprobar una conexión desde la Function, una escritura/lectura duradera, aislamiento entre clientes, cancelación y rechazo de doble reserva. Verificar también que la identidad de ejecución no puede modificar el esquema ni eliminar citas. Registrar la restauración de un respaldo antes de declarar cumplidos RPO/RTO.

Mantener `TRUST_SWA_PRINCIPAL="false"` hasta cumplir el [procedimiento de activación de AuthV2](README.md#4-seguridad-obligatoria-antes-de-publicar-citas) y las pruebas de persistencia. No configurar `APP_ENV=local/test` ni `PERSISTENCE=memory` en la Function de Azure para evitar este bloqueo.

## Referencias de implementación

- [AzureRM 4.81.0: SQL Server](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.81.0/website/docs/r/mssql_server.html.markdown).
- [AzureRM 4.81.0: SQL Database](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.81.0/website/docs/r/mssql_database.html.markdown).
- [Microsoft: límites DTU, incluida Basic](https://learn.microsoft.com/en-us/azure/azure-sql/database/resource-limits-dtu-single-databases?view=azuresql).
- [Microsoft: respaldos y retención](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql).
- [Microsoft: direcciones IP de Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/ip-addresses).
- [Microsoft: autenticación exclusiva de Entra](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-azure-ad-only-authentication?view=azuresql).
