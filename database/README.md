# Azure SQL DEV — Veterinaria Patitas

## Estado de integración

La infraestructura SQL se preparó en el PR #9, fusionado en una rama intermedia. El PR #11 de Nicolás incorpora migraciones, repositorios asíncronos y mapeo de clientes. La integración de ambas partes en `main` y las pruebas reales en Azure siguen pendientes. La presencia del código no acredita que la base exista, que se hayan aplicado scripts o que la conexión funcione.

## Contrato de configuración

| App setting | Valor en DEV | Función |
| --- | --- | --- |
| `PERSISTENCE` | `sql` | Selecciona el repositorio SQL |
| `SQL_SERVER_FQDN` | FQDN del servidor creado por Terraform | Servidor de conexión |
| `SQL_DATABASE_NAME` | `patitas-dev` | Base de datos |
| `SQL_AUTH_MODE` | `managed-identity` | Modo admitido por el contrato de runtime |
| `APP_ENV` | `dev` | Impide usar memoria en Azure |
| `TRUST_SWA_PRINCIPAL` | `false` hasta verificar el entorno | Mantiene bloqueadas las operaciones privadas |

Terraform agrega el selector `PERSISTENCE=sql` y los tres ajustes SQL únicamente cuando `sql_enabled=true`. El backend valida esos nombres; los antiguos `SQL_SERVER` y `SQL_DATABASE` no forman parte del contrato.

La conexión usa un token de Microsoft Entra con `DefaultAzureCredential`, cifrado y validación de certificado. En la Function se utiliza la identidad administrada de sistema preparada por Terraform. En desarrollo y en las pruebas, la cadena puede usar credenciales de Azure CLI u otras credenciales de desarrollador admitidas. `SQL_AUTH_MODE` valida el modo configurado, pero no reemplaza la selección de credenciales de esa cadena.

No copiar el `AZURE_CLIENT_ID` de GitHub Actions a la Function como si identificara su usuario SQL. La identidad de despliegue y la identidad administrada de ejecución son distintas. La identidad `SystemAssigned` elegida no necesita un client ID configurado en el proceso para seleccionarla.

## Identidades y permisos

| Identidad | Uso |
| --- | --- |
| Aplicación OIDC de GitHub | Gestionar la infraestructura con Terraform |
| Administrador Entra de SQL o identidad de migraciones | Crear esquema, índices y usuarios de base de datos |
| Identidad administrada de la Function | Consultar, crear y actualizar datos de negocio |
| Identidad de pruebas DEV | Ejecutar la prueba que crea y elimina datos sintéticos |
| `userId` de SWA | Identificar al cliente de negocio y aplicar sus permisos |

El backend del PR #11 resuelve `userId de SWA → Clientes.identity_id → Clientes.id`. La identidad SWA es una cadena opaca; `Clientes.id` es el UUID interno usado por SQL. La query administrativa de mascotas selecciona ese cliente interno. No confundir estos valores con el client/application ID de la Function ni con el de GitHub.

El rol de runtime `patitas_api_runtime` concede `SELECT`, `INSERT` y `UPDATE` sobre `dbo`. Es suficiente para el repositorio actual. La cancelación actualiza el estado; no elimina registros. La limpieza de pruebas requiere `DELETE` y debe ejecutarse con una identidad de pruebas separada. No ampliar los permisos de la Function a `db_datawriter` para satisfacer esa limpieza.

## Orden de preparación

1. **Crear y verificar los recursos DEV:** servidor, base `patitas-dev`, administrador Entra e identidad administrada de la Function. Revisar el plan Terraform y las IP de administración/salida antes de aplicarlo.
2. **Preparar el usuario de runtime:** consultar el `principalId` de la Function y obtener el **application/client ID de esa misma identidad**:

   ```bash
   az ad sp show --id "<function-principal-id>" --query appId --output tsv
   ```

   Sustituir el GUID de ceros de `@clientId` en [bootstrap/runtime-user-dev.sql](bootstrap/runtime-user-dev.sql) y ejecutar el lote completo como administrador Entra en `patitas-dev`, sin transacción abierta. El script crea el usuario `patitas-api-dev` y su rol limitado. Para `CREATE USER ... WITH SID ..., TYPE = E`, usar el client/application ID de la identidad administrada, según la [sección K de Microsoft](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql?view=azuresqldb-current#k-create-a-contained-database-user-from-a-microsoft-entra-principal-without-validation). SQL no valida ese SID en Entra; verificar su correspondencia antes de ejecutarlo. El bootstrap no revoca privilegios concedidos previamente.
3. **Aplicar el esquema y el catálogo del PR #11** mediante una identidad administrativa/de migraciones independiente:
   - `database/migrations/001_init.sql`.
   - `database/seeds/001_catalogos_dev.sql`, con datos sintéticos.

   Antes de ejecutarlos, completar la revisión de transacciones y opciones SET necesarias para el índice filtrado. El usuario de runtime no administra el esquema.
4. **Preparar un cliente de prueba:** `database/seeds/002_cliente_demo.template.sql` usa sustitución SQLCMD dentro de texto SQL. Su carga con valores variables requiere parametrización y una transacción antes de usarse con nombres o identidades suministrados por usuarios. No usar esa sustitución como si escapara valores.
5. **Publicar el backend SQL y comprobar la conexión** con sus settings completos. Verificar lectura/escritura, aislamiento entre clientes, conflicto 409 en reservas concurrentes y persistencia después de reiniciar.
6. **Verificar SWA/Functions y habilitar la confianza** siguiendo [la guía de infraestructura](../infra/terraform/README.md#4-seguridad-obligatoria-antes-de-publicar-citas). Repetir las pruebas con sesión real después del cambio de configuración versionado.

Los scripts de esquema y seeds pertenecen al incremento del PR #11; el bootstrap pertenece al incremento de infraestructura SQL. Integrar ambos antes de ejecutar este procedimiento.

## Prueba de integración SQL

La prueba `apps/api/src/repositories/azureSql.integration.test.ts` requiere servidor y base DEV configurados con los nombres del contrato, una identidad de pruebas autorizada y el esquema aplicado. Crea identificadores sintéticos aleatorios, ensaya reservas concurrentes y elimina sus datos al finalizar.

Desde la raíz del repositorio, con esa configuración completa:

```bash
npm test --prefix apps/api -- src/repositories/azureSql.integration.test.ts
```

Una prueba omitida no demuestra conexión ni persistencia. La CI común utiliza pruebas con mocks y omite el acceso SQL cuando no tiene configuración de integración; comprobar que el caso real se ejecute antes de usar su resultado como evidencia. No ejecutar esa limpieza contra producción ni con la identidad limitada de la Function.

## Reglas del dominio

- Citas, mascotas, veterinarios, servicios y clientes internos usan UUID. `Clientes.identity_id` conserva el identificador SWA como texto único.
- `inicioUtc` se guarda normalizado en UTC; la interfaz mostrará `America/Bogota`.
- `motivo` es opcional, con máximo de 200 caracteres.
- Estados: `PROGRAMADA` y `CANCELADA`. Una cancelación ajena para CLIENTE devuelve 404.
- El índice único filtrado de `(veterinario_id, inicio_utc)` para citas `PROGRAMADA` protege las franjas actuales de 30 minutos. Si cambia la duración, revisar solapamientos.
- Un fallo SQL no habilita una alternativa de memoria en Azure.

Referencias: [ADR-002](../docs/adr/ADR-002-datos.md), [node-mssql](https://tediousjs.github.io/node-mssql/) e [identidad administrada de Functions con Azure SQL](https://learn.microsoft.com/en-us/azure/azure-functions/functions-identity-access-azure-sql-with-managed-identity).
