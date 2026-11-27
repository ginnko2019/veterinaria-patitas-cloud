# Patitas API

Azure Functions con repositorios de memoria para pruebas locales y Azure SQL para
DEV. El código y las pruebas unitarias no acreditan por sí solos una conexión
SQL real ni el aislamiento entre Static Web Apps (SWA) y la Function.

## Configuración

| Variable | Valor / comportamiento |
| --- | --- |
| `APP_ENV` | `local` o `test` permite memoria. Un valor explícito, como `dev` o `prod`, prevalece sobre `NODE_ENV`. |
| `PERSISTENCE` | `memory` o `sql`. Ausente o desconocido provoca un error de configuración; no hay cambio automático a memoria. |
| `SQL_SERVER_FQDN` | Nombre completo del servidor, por ejemplo `nombre-dev.database.windows.net`. Obligatorio con `PERSISTENCE=sql`. |
| `SQL_DATABASE_NAME` | Nombre de la base, `patitas-dev` para DEV. Obligatorio con `PERSISTENCE=sql`. |
| `SQL_AUTH_MODE` | Debe ser exactamente `managed-identity` con `PERSISTENCE=sql`. Es el contrato de despliegue, no un selector de credenciales del SDK. |
| `TRUST_SWA_PRINCIPAL` | El ejemplo mantiene `false`. Su activación depende de la vinculación y las comprobaciones reales descritas en [seguridad de identidad](../../docs/seguridad-identidad.md). |

Estos nombres coinciden con los app settings de Terraform. `SQL_SERVER` y
`SQL_DATABASE` no se usan como alternativas. El servidor y la base admiten
espacios exteriores, que se eliminan; un valor vacío, un modo ausente o un modo
desconocido hace fallar la configuración. En una petición autenticada, el
cliente recibe `500` con `{ "code": "ERROR_INTERNO", "message": "Ocurrió un error interno." }`.

`local.settings.example.json` inicia en `PERSISTENCE=memory`, `APP_ENV=local` y
confianza SWA desactivada. Copiarlo a `local.settings.json` configura Functions
Core Tools; Vitest lee las variables de su proceso y no carga ese archivo.

## Credenciales de SQL

El repositorio conserva `DefaultAzureCredential` y solicita un token para
`https://database.windows.net/.default`. La cadena puede resolver credenciales
de entorno o de carga de trabajo antes de la identidad administrada; en desarrollo
también admite una sesión de Azure CLI (`az login`). Por tanto,
`SQL_AUTH_MODE=managed-identity` **no obliga** al SDK a elegir una identidad
concreta. En Azure se espera utilizar la identidad administrada de la Function y
debe comprobarse qué identidad resolvió la cadena en ese entorno.

La identidad del usuario recibida por SWA autoriza las operaciones de negocio;
la identidad de la Function autoriza el acceso a SQL. La aplicación de despliegue
GitHub OIDC es otra identidad. El alta del usuario SQL y sus permisos se describen
en [database/README.md](../../database/README.md).

La conexión usa cifrado, valida el certificado del servidor y maneja las fechas
en UTC. Cada pool instala un listener antes de conectar; los errores emitidos
por el pool registran solo `SQL_POOL_ERROR`, sin mensajes del driver, consultas,
tokens ni datos del cliente. Los errores de las peticiones conservan su manejo
HTTP existente.

## Comprobación local

Desde `apps/api`:

```sh
npm ci
npm run build
npm test
```

Sin variables SQL, la suite común omite la integración SQL. Si se define alguna
de `SQL_SERVER_FQDN`, `SQL_DATABASE_NAME` o `SQL_AUTH_MODE`, exige el contrato
completo y falla ante una configuración parcial antes de contactar a Azure.
La suite de seguridad omite las comprobaciones reales solo cuando no se
configuraron ni `FUNCTION_DIRECT_URL` ni `SWA_API_URL`; el comando estricto
`npm run test:seguridad:azure` requiere ambas.

Para ejecutar la integración SQL en un DEV ya preparado, sustituir el servidor
y usar una identidad de pruebas autorizada:

```sh
SQL_SERVER_FQDN="nombre-dev.database.windows.net" \
SQL_DATABASE_NAME="patitas-dev" \
SQL_AUTH_MODE="managed-identity" \
npx vitest run src/repositories/azureSql.integration.test.ts
```

Esta prueba inserta datos sintéticos y usa `DELETE` para limpiar sus propios
registros; ese permiso corresponde a la identidad de pruebas. Invoca handlers
en el proceso de pruebas y comprueba concurrencia, cancelación y aislamiento
entre clientes. No valida el acceso HTTP real por SWA. Si la cadena utiliza
Azure CLI, su resultado acredita esa credencial, no el acceso mediante la
identidad administrada desplegada. Las ejecuciones omitidas no constituyen
evidencia de SQL ni SWA.

Referencias: [DefaultAzureCredential](https://learn.microsoft.com/en-us/javascript/api/@azure/identity/defaultazurecredential?view=azure-node-latest)
y [node-mssql: conexiones y eventos del pool](https://tediousjs.github.io/node-mssql/#connections).
