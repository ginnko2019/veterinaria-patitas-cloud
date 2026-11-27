# Infraestructura de Veterinaria Patitas (PEMU 2026)

Este directorio declara la **primera capa cloud** mediante Terraform: Resource Group, Azure Storage para el runtime, App Service Plan Linux Consumption, Azure Functions Node.js 22, Application Insights/Log Analytics y Static Web Apps Standard con una Function vinculada como backend.

**Alcance actual:** infraestructura y asociación SWA/Functions, con Azure SQL opcional **solo para DEV**. SQL permanece deshabilitado hasta configurar su administrador Entra y habilitarlo expresamente. Los PR [#6](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/6), [#10](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/10) y [#11](https://github.com/ginnko2019/veterinaria-patitas-cloud/pull/11) ya están integrados en `main`: incluyen los handlers y controles de identidad, la consulta de mascotas y el repositorio SQL con su migración inicial. El aprovisionamiento, la publicación de las aplicaciones, la ejecución de migraciones y las pruebas reales en Azure siguen pendientes. Terraform no publica las aplicaciones ni ejecuta las migraciones; tampoco acredita un despliegue real.

Para preparar la base DEV y la conexión de Nicolás, seguir [SQL-DEV.md](SQL-DEV.md).

## Estructura

- `versions.tf`: proveedor AzureRM 4.x y estado remoto.
- `.terraform.lock.hcl`: versión y sumas de verificación del proveedor; se versiona y el pipeline lo utiliza sin modificarlo.
- `variables.tf`: variables y validaciones.
- `main.tf`: recursos declarativos.
- `outputs.tf`: nombres y URL sin credenciales.
- `sql.tf`, `sql-variables.tf` y `sql-outputs.tf`: servidor/base DEV, acceso de red y configuración de conexión sin contraseñas.
- `tests/sql.tftest.hcl`: planes con un proveedor simulado; no crea recursos en Azure.
- `environments/dev.tfvars` y `environments/prod.tfvars`: parámetros de ambiente.
- `.github/workflows/terraform.yml`: validación y plan/apply desde GitHub Actions.

## 1. Único bootstrap externo (antes del primer pipeline)

Como el estado remoto y la identidad que ejecutará Terraform deben existir antes de Terraform, prepararlos una sola vez desde Azure Cloud Shell, siguiendo el Laboratorio 6 GitOps (OIDC y estado remoto).

1. Elegir la suscripción correcta (`Azure subscription 1`) y confirmar permisos para crear Resource Groups y asignar RBAC.
2. Crear un **grupo de recursos para el estado**, una cuenta Storage y un contenedor privado `tfstate`, habilitando autenticación Azure AD y acceso mínimo a los blobs.
3. Crear una identidad federada para GitHub Actions, con credenciales OIDC de `dev` y `prod`, ligadas **a los sujetos reales de GitHub**; no asumir que el formato antiguo del subject sigue vigente.
4. Darle solo los permisos de administración de infraestructura necesarios. Para el estado, asignar `Storage Blob Data Contributor` sobre el contenedor correspondiente. Evitar Owner permanente.
5. Crear en GitHub **Settings → Environments** dos ambientes: `dev` y `prod`. Configurar al menos un aprobador para producción, revisando la disponibilidad de estas protecciones en el plan de GitHub.
6. Establecer las siguientes **Environment variables** (no contraseñas) en **ambos** ambientes:

| Variable | Significado |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID de la identidad federada |
| `AZURE_TENANT_ID` | Tenant ID de Entra |
| `AZURE_SUBSCRIPTION_ID` | ID de la suscripción |
| `TF_STATE_RG` | Resource Group existente del estado remoto |
| `TF_STATE_STORAGE` | Storage Account existente del estado remoto |
| `TF_STATE_CONTAINER` | Contenedor del estado (ej. `tfstate`) |
| `TF_NAME_SUFFIX` | Cadena única 4–10 caracteres `[a-z0-9]` usada para recursos globales |

**Nunca guardar valores sensibles en el repositorio ni usar access keys como secretos de GitHub.** El backend Terraform utiliza OIDC y RBAC. El estado sí puede contener claves técnicas sensibles de los recursos que administra; restringir lectura y escritura y protegerlo mediante Storage cifrado.

### Confirmar el subject OIDC antes de crear la credencial federada

GitHub utiliza sujetos inmutables para repositorios creados desde el 15 de julio de 2026. Este repositorio fue creado el 12 de noviembre de 2026; los identificadores públicos verificados son owner `53383580` y repository `1454648615`. Con la plantilla predeterminada y los Environments del workflow, los valores **esperados** son:

| Environment | Subject esperado |
| --- | --- |
| `dev` | `repo:ginnko2019@53383580/veterinaria-patitas-cloud@1454648615:environment:dev` |
| `prod` | `repo:ginnko2019@53383580/veterinaria-patitas-cloud@1454648615:environment:prod` |

Estos valores no acreditan que se haya verificado el token o la personalización OIDC del repositorio. Antes de crear cada credencial federada, comprobar en la configuración o vista previa de GitHub el subject real del Environment y cualquier plantilla personalizada. La credencial debe coincidir exactamente con ese valor, con issuer `https://token.actions.githubusercontent.com` y audience `api://AzureADTokenExchange`. No utilizar automáticamente el formato antiguo basado solo en nombres. Consultar la [referencia OIDC de GitHub](https://docs.github.com/en/actions/reference/security/oidc) y la [guía de Microsoft sobre sujetos inmutables](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects).

## 2. Comprobación automática

Cada Pull Request que cambie `infra/terraform/**` dispara:

- `actionlint` para comprobar las expresiones y los scripts del workflow.
- `terraform fmt -check -recursive`
- `terraform init -backend=false -lockfile=readonly` (no necesita acceso Azure)
- `terraform validate`
- `terraform test` con proveedor simulado: SQL opcional, configuración DEV y rechazos de PROD, firewall abierto o administrador ausente.

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
