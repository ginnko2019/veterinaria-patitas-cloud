# Infraestructura de Veterinaria Patitas (PEMU 2026)

Este directorio declara la **primera capa cloud** mediante Terraform: Resource Group, Azure Storage para el runtime, App Service Plan Linux Consumption, Azure Functions Node.js 22, Application Insights/Log Analytics y Static Web Apps Standard con una Function vinculada como backend.

**Alcance actual:** infraestructura y asociación SWA/Functions, con Azure SQL opcional **solo para DEV**. SQL permanece deshabilitado hasta configurar su administrador Entra y habilitarlo expresamente. Los PR [#6](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/6), [#10](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/10) y [#11](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/11) ya están integrados en `main`: incluyen los handlers y controles de identidad, la consulta de mascotas y el repositorio SQL con su migración inicial. El aprovisionamiento, la publicación de las aplicaciones, la ejecución de migraciones y las pruebas reales en Azure siguen pendientes. Terraform no publica las aplicaciones ni ejecuta las migraciones; tampoco acredita un despliegue real.

Para preparar la base DEV y la conexión de Nicolás, seguir [SQL-DEV.md](SQL-DEV.md).

## Estructura

- `versions.tf`: proveedor AzureRM 4.x y estado remoto.
- `.terraform.lock.hcl`: versión y sumas de verificación del proveedor; se versiona y el pipeline lo utiliza sin modificarlo.
- `variables.tf`: variables y validaciones.
- `imports.tf`: adopcion declarativa y opcional del grupo precreado por el bootstrap.
- `main.tf`: recursos declarativos.
- `outputs.tf`: nombres y URL sin credenciales.
- `sql.tf`, `sql-variables.tf` y `sql-outputs.tf`: servidor/base DEV, acceso de red y configuración de conexión sin contraseñas.
- `tests/sql.tftest.hcl`: planes con un proveedor simulado; no crea recursos en Azure.
- `tests/bootstrap.tftest.hcl`: limites del ID de importacion y plan simulado de adopcion.
- `../../scripts/bootstrap-azure-dev.sh`: preparacion administrativa de grupos, estado y RBAC DEV.
- `environments/dev.tfvars` y `environments/prod.tfvars`: parámetros de ambiente.
- `.github/workflows/terraform.yml`: validación y plan/apply desde GitHub Actions.

## 1. Único bootstrap externo (antes del primer pipeline)

Como el estado remoto y la identidad que ejecutará Terraform deben existir antes de Terraform, prepararlos una sola vez desde Azure Cloud Shell, siguiendo el Laboratorio 6 GitOps (OIDC y estado remoto).

1. Elegir la suscripción correcta (`Azure subscription 1`) y confirmar permisos para crear Resource Groups y asignar RBAC.
2. Crear la aplicacion, su service principal y la credencial federada de GitHub Actions, ligada **al subject real del Environment**. DEV y PROD requieren preparaciones separadas.
3. Ejecutar el bootstrap DEV descrito abajo: precrear `rg-patitas-dev`, preparar un grupo separado para el estado, registrar los namespaces necesarios y asignar los dos roles con ambitos limitados.
4. Crear en GitHub **Settings → Environments** el ambiente `dev` y limitar sus despliegues a la rama `main`. Preparar `prod` cuando corresponda, con aprobacion de otro integrante antes de desplegar.
5. Establecer las siguientes **Environment variables** (no contraseñas) para cada ambiente preparado:

| Variable | Significado |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID de la identidad federada |
| `AZURE_TENANT_ID` | Tenant ID de Entra |
| `AZURE_SUBSCRIPTION_ID` | ID de la suscripción |
| `TF_STATE_RG` | Resource Group existente del estado remoto |
| `TF_STATE_STORAGE` | Storage Account existente del estado remoto |
| `TF_STATE_CONTAINER` | Contenedor del estado (ej. `tfstate`) |
| `TF_NAME_SUFFIX` | Cadena única 4–10 caracteres `[a-z0-9]` usada para recursos globales |
| `TF_RESOURCE_GROUP_ID` | ID ARM del grupo precreado; obligatorio para DEV en este workflow |

**Nunca guardar valores sensibles en el repositorio ni usar access keys como secretos de GitHub.** El backend Terraform utiliza OIDC y RBAC. El estado sí puede contener claves técnicas sensibles de los recursos que administra; restringir lectura y escritura y protegerlo mediante Storage cifrado.

### Bootstrap DEV con permisos limitados

Ejecutar [scripts/bootstrap-azure-dev.sh](../../scripts/bootstrap-azure-dev.sh) en Azure Cloud Shell Bash con una identidad administrativa autorizada para registrar proveedores, crear los recursos indicados y asignar RBAC. Los identificadores se pasan como argumentos; no se guardan valores personales en el script.

```bash
bash scripts/bootstrap-azure-dev.sh \
  --subscription-id '<subscription-id>' \
  --tenant-id '<tenant-id>' \
  --client-id '<client-id-de-github>' \
  --service-principal-id '<object-id-del-service-principal>' \
  --name-suffix '<sufijo-4-a-10-caracteres>' \
  --location eastus2
```

El script prepara `rg-patitas-dev` y, por separado, `rg-patitas-tfstate-dev`, la cuenta `stpatitasstate<SUFFIX>` y el contenedor `tfstate`. El storage usa Standard LRS, TLS 1.2, HTTPS, autenticacion Entra sin Shared Key ni acceso anonimo, versionado y retencion para borrados. El endpoint permanece publico y autenticado para permitir acceso desde runners alojados por GitHub; este paso no implementa una red privada. Los recursos existentes deben coincidir con el proyecto, ambiente, ubicacion y configuracion esperados; un conflicto se informa sin sobrescribir el recurso ajeno.

| Rol de la identidad GitHub | Ambito |
| --- | --- |
| `Contributor` | Solo `rg-patitas-dev` |
| `Storage Blob Data Contributor` | Solo el contenedor `tfstate` de la cuenta de estado |

El bootstrap registra `Microsoft.Storage`, `Microsoft.Web`, `Microsoft.Insights`, `Microsoft.OperationalInsights` y `Microsoft.Sql`. AzureRM declara `resource_provider_registrations="none"` para no intentar registrarlos con la identidad limitada de GitHub. El contenedor se crea mediante ARM, sin obtener claves del storage. El JSON final contiene las cinco variables `TF_*` que deben configurarse en el Environment `dev`.

El grupo de la aplicacion se adopta mediante `resource_group_import_id` e `imports.tf`. El workflow verifica que `TF_RESOURCE_GROUP_ID` coincida con la suscripcion y el ambiente seleccionados. El primer `plan` muestra la importacion; solo `apply` la registra en el estado. Una vez importado, los planes siguientes no repiten esa accion. Dejar el ID vacio conserva la creacion normal para usos locales u otros ambientes; el workflow DEV exige el bootstrap. Los mocks validan el contrato y el plan simulado, no prueban una importacion en Azure.

Referencias: [importaciones declarativas](https://developer.hashicorp.com/terraform/language/import/single-resource), [AzureRM 4.81.0 y registro de proveedores](https://github.com/hashicorp/terraform-provider-azurerm/blob/v4.81.0/website/docs/index.html.markdown) y [permisos del backend Azure](https://developer.hashicorp.com/terraform/language/backend/azurerm).

### Confirmar el subject OIDC antes de crear la credencial federada

GitHub utiliza sujetos inmutables para repositorios creados desde el 15 de julio de 2026. Este repositorio fue creado el 12 de noviembre de 2026; los identificadores públicos verificados son owner `53383580` y repository `1454648615`. Con la plantilla predeterminada y los Environments del workflow, los valores **esperados** son:

| Environment | Subject esperado |
| --- | --- |
| `dev` | `repo:ginnko2019@53383580/veterinaria-patitas-cloud@1454648615:environment:dev` |
| `prod` | `repo:ginnko2019@53383580/veterinaria-patitas-cloud@1454648615:environment:prod` |

El 27 de noviembre de 2026 se verifico en la UI de GitHub la plantilla predeterminada y el prefijo inmutable de este repositorio. Se creo `dev`, limitado a `main`, y se guardaron los identificadores Azure y del administrador SQL. Rodrigo confirmo mediante la salida de Azure CLI la creacion del service principal y de `github-patitas-dev`, con el subject DEV mostrado, issuer `https://token.actions.githubusercontent.com` y audience `api://AzureADTokenExchange`. La emision del token y su aceptacion por Azure todavia deben comprobarse mediante una ejecucion real. PROD sigue pendiente. Antes de agregar otra credencial, volver a comprobar su Environment y la configuracion OIDC. Consultar la [referencia OIDC de GitHub](https://docs.github.com/en/actions/reference/security/oidc) y la [guía de Microsoft sobre sujetos inmutables](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects).

## 2. Comprobación automática

Cada Pull Request que cambie `infra/terraform/**` dispara:

- `actionlint` para comprobar las expresiones y los scripts del workflow.
- `terraform fmt -check -recursive`
- `terraform init -backend=false -lockfile=readonly` (no necesita acceso Azure)
- `terraform validate`
- `terraform test` con proveedor simulado: SQL opcional, configuración DEV y rechazos de PROD, firewall abierto o administrador ausente.
- Comprobacion de importacion opcional y rechazo de IDs de otro ambiente o de suscripcion mal formada, mediante mocks y un override limitado al caso positivo.

Estas comprobaciones **no prueban** permisos, disponibilidad regional ni costos. Es necesario ejecutar `plan` contra la suscripción antes de afirmar que el despliegue funciona.

Los estados, planes y archivos temporales de Terraform se excluyen mediante `.gitignore`; el estado remoto se guarda únicamente en el backend configurado. Las ejecuciones de infraestructura del mismo ambiente se serializan para evitar operaciones simultáneas.

## 3. Plan y despliegue DEV/PROD desde GitHub Actions

Una vez completado el bootstrap y las variables:

1. Abrir **Actions → Infraestructura Terraform - Veterinaria Patitas → Run workflow** en `main`.
2. Elegir `environment=dev` y `operation=plan`, revisar los recursos y costos previstos.
3. Ejecutar `environment=dev`, `operation=apply` para aplicar exactamente el plan calculado en la misma ejecución.
4. Repetir `plan` y luego `apply` para `prod`, **solo con la aprobación humana configurada en GitHub Environments**.
5. El estado DEV y PROD se separa por las claves `patitas-dev.tfstate` y `patitas-prod.tfstate`.

El pipeline **no realiza apply automáticamente con cada push**: esto evita crear recursos facturables o desplegar cambios en producción sin autorización. Cada ejecución `apply` parte de un plan generado y validado dentro de esa misma ejecución.

### Publicación del paquete de Azure Functions

Linux Consumption (`Y1`) no admite `WEBSITE_RUN_FROM_PACKAGE=1`. Por eso esta capa no define ese valor. El futuro pipeline de la API deberá publicar el ZIP compilado en almacenamiento privado y configurar `WEBSITE_RUN_FROM_PACKAGE` con la URL del paquete, preferiblemente con acceso mediante identidad administrada. En ese incremento se definirá quién administra esa propiedad para evitar que Terraform revierta la URL. Ver [despliegue de paquetes de Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/deployment-zip-push) y [tecnologías de despliegue](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies?tabs=linux).

## 4. Seguridad obligatoria antes de publicar citas

La integración `azurerm_static_web_app_function_app_registration` asocia Azure Functions a Static Web Apps Standard y configura autenticación AuthV2. El archivo `apps/web/public/staticwebapp.config.json` exige usuarios autenticados en `/api/*`, salvo `/api/health`.

La asociación SWA administra `auth_settings_v2`; la Function utiliza `lifecycle.ignore_changes = [auth_settings_v2]` para preservar esa configuración en aplicaciones posteriores de Terraform, siguiendo el [ejemplo oficial de AzureRM](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/static_web_app_function_app_registration). Cuando exista el entorno, revisar un segundo `terraform plan` y repetir la prueba de acceso directo. Microsoft describe la protección del backend vinculado en [Bring your own functions to Azure Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own).

Terraform declara `TRUST_SWA_PRINCIPAL="false"` y `APP_ENV=dev/prod`. El backend integrado desde el PR #6 rechaza los principales SWA mientras la confianza esté apagada. La memoria queda limitada a desarrollo local y pruebas. Cuando `sql_enabled=true`, Terraform configura `PERSISTENCE="sql"` junto con el servidor, la base y el modo de autenticación que ya consume la API integrada desde el PR #11; con SQL apagado, omite los cuatro settings. Seleccionar SQL no publica esa API, no ejecuta migraciones ni acredita su conexión. Las operaciones de negocio permanecen bloqueadas hasta completar el despliegue, la configuración y las verificaciones necesarias.

La activación requiere evidencia del entorno real, en este orden:

1. Conservar la confianza apagada al crear los recursos y publicar los artefactos. Inspeccionar en Azure que AuthV2 está habilitado, exige autenticación y utiliza el proveedor vinculado a la SWA correcta. La protección es de autenticación de plataforma; no sustituirla por restricciones IP que impidan la asociación SWA.
2. Comprobar que `/api/health` responde `200` con `{"status":"ok","service":"patitas-api"}` a través de esa SWA y que el mismo endpoint, accedido directamente a la Function sin identidad o con un principal falsificado, responde `401`/`403`. El rechazo de una ruta privada con el flag apagado no demuestra por sí solo el bloqueo de plataforma.
3. Ejecutar desde la raíz del repositorio la comprobación estricta incorporada por el PR #6 contra ambas URL reales, incluyendo `/api`:

   ```bash
   FUNCTION_DIRECT_URL='https://<functionapp>.azurewebsites.net/api' \
   SWA_API_URL='https://<staticwebapp>.azurestaticapps.net/api' \
   npm run test:seguridad:azure --prefix apps/api
   ```

   Una URL ausente, un error de red, un `404` o una prueba omitida no acreditan el aislamiento. Conservar el resultado junto con la configuración AuthV2 inspeccionada.
4. Completar y probar SQL, migraciones, permisos de ejecución y persistencia; después, cambiar `TRUST_SWA_PRINCIPAL` a `"true"` mediante un cambio revisado en Terraform. Repetir la comprobación de acceso directo con la confianza activa y verificar una sesión legítima a través de SWA, incluidos roles y propiedad de mascotas/citas.

Un cambio manual del flag en el portal se revertiría en el siguiente `terraform apply`; la activación debe quedar en la configuración versionada. Los detalles del helper, los roles y las pruebas se mantienen en [la guía de identidad](../../docs/seguridad-identidad.md), integrada desde el PR #6. **No habilitar citas reales antes de completar estas verificaciones.**

## 5. Pendientes para completar la rúbrica

- Aprovisionamiento real y acceso de SQL DEV (Rodrigo); publicar la API integrada, aplicar sus migraciones y ejecutar las pruebas de persistencia y concurrencia en Azure (Nicolás).
- Validación de autenticación en el entorno desplegado, asignación de roles y ejecución de las pruebas directas de acceso seguro incorporadas por el PR #6.
- Pipeline que **publique el artefacto compilado** React/Functions en Azure, con smoke tests y rollback.
- Alerta de observabilidad y prueba de falla/recuperación.
- Estimación de costos oficial con escenarios DEV, MVP y producción (Excel).
- HLD, diagramas, ADR y presentación (máximo 10 diapositivas).

No afirmar que se cumple 99,5 % SLA, RPO 24 h, RTO 4 h o presupuesto USD 150/mes hasta validarlo documentalmente y con pruebas.
