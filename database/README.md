# Azure SQL DEV — Veterinaria Patitas

**Estado de este incremento:** preparación de infraestructura y acceso administrativo; **no desplegado ni ejecutado contra Azure SQL**. Con los controles del PR #6, la memoria solo está permitida en local/test; las operaciones de negocio en Azure quedan bloqueadas hasta implementar y configurar la persistencia SQL. Nicolás implementará las migraciones y el repositorio; los app settings no activan esa integración por sí solos.

## Contrato con la Function

| App setting | Valor esperado | Uso pendiente en el backend |
| --- | --- | --- |
| `SQL_SERVER_FQDN` | FQDN del servidor creado por Terraform | Servidor de conexión |
| `SQL_DATABASE_NAME` | `patitas-dev` | Base de datos de DEV |
| `SQL_AUTH_MODE` | `managed-identity` | Identidad administrada `SystemAssigned` de la Function |

Son nombres propios de Patitas: Nicolás debe leerlos y configurar el driver. No son opciones que `mssql` interprete automáticamente. La conexión debe cifrarse y validar el certificado (`encrypt: true`, `trustServerCertificate: false`), con consultas parametrizadas y gestión del pool/token conforme al driver. No se requiere una contraseña SQL ni `AZURE_CLIENT_ID` para la identidad de sistema elegida. Véanse [node-mssql](https://tediousjs.github.io/node-mssql/) y la [guía de identidad administrada de Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-identity-access-azure-sql-with-managed-identity).

La identidad **SWA** identifica al cliente y sus roles `CLIENTE`/`ADMIN`. La identidad **administrada de la Function** autentica a la aplicación ante SQL. El backend mantiene las comprobaciones de propiedad de mascotas y citas.

El dominio actual utiliza el `userId` opaco de SWA como `usuario.id` y lo compara con `clienteId`. Si las migraciones introducen una clave interna distinta para el cliente, Nicolás debe resolver explícitamente `identity_id` de SWA hacia ese cliente y adaptar el repositorio/servicio sin mezclar ambos identificadores. El client/application ID del bootstrap SQL identifica a la Function, no a los clientes de negocio. Este mapeo sigue pendiente de la implementación SQL.

## Activación en DEV

1. **Crear los recursos:** revisar y aplicar Terraform de DEV con administrador Entra configurado; comprobar el FQDN, la base `patitas-dev` y la identidad de sistema de la Function. Este repositorio no acredita que ese despliegue ya se haya ejecutado.
2. **Permitir las IP necesarias:** autorizar la IP de administración y las salidas de la Function previstas por la configuración de red. No usar una regla abierta a todas las IP como sustituto. Probar conectividad desde el origen real.
3. **Preparar el acceso SQL como administrador Entra:** obtener el `principalId` de la Function y consultar el **application/client ID** de esa misma identidad con lectura autorizada en Entra:

   ```bash
   az ad sp show --id "<function-principal-id>" --query appId --output tsv
   ```

   El comando [consulta un service principal](https://learn.microsoft.com/en-us/cli/azure/ad/sp?view=azure-cli-latest#az-ad-sp-show); no concede roles de directorio. Si la cuenta no puede leerlo, un administrador autorizado debe proporcionar ese `appId`. No añadir permisos globales para este paso.

   Abrir [bootstrap/runtime-user-dev.sql](bootstrap/runtime-user-dev.sql), sustituir el GUID de ceros de `@clientId` por ese **client ID**, y ejecutar el lote completo en una conexión Entra administrativa a `patitas-dev`, sin una transacción abierta. **No usar el principal/object ID como SID.** La [sección K de `CREATE USER`](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql?view=azuresqldb-current#k-create-a-contained-database-user-from-a-microsoft-entra-principal-without-validation) documenta `SID` y `TYPE = E` para Azure SQL Database y exige client ID para identidades administradas. SQL no valida ese identificador en Entra; el operador verifica su correspondencia con la Function.

   El lote crea `patitas-api-dev` y el rol `patitas_api_runtime`, y concede `SELECT`, `INSERT` y `UPDATE` sobre `dbo`. Es una propuesta DEV para el CRUD actual. Puede repetirse con la misma identidad; se detiene si el usuario existente tiene otro SID/tipo. No concede `DELETE`, DDL ni `db_owner`, y **no revoca permisos previos**: los permisos heredados o concedidos por otros procedimientos requieren revisión aparte.
4. **Aplicar las migraciones de Nicolás** con una identidad administrativa/de migración independiente, desde `database/migrations/` cuando él las incorpore. El usuario de runtime no administra el esquema. Este incremento no crea tablas ni datos.
5. **Conectar y probar con la identidad de la Function:** Nicolás implementa el repositorio SQL y adapta el servicio a `async/await`. Verificar conexión, aislamiento entre clientes, reserva concurrente con conflicto `409`, cancelación y conservación de los datos tras reiniciar. El bootstrap exitoso no demuestra estas pruebas. No sustituir un fallo SQL por persistencia en memoria en el despliegue.

La confianza en los principales SWA permanece apagada hasta verificar AuthV2 y el acceso directo, además de la persistencia. Seguir el [procedimiento de activación de infraestructura](../infra/terraform/README.md#4-seguridad-obligatoria-antes-de-publicar-citas); la creación del usuario SQL no autoriza activar ese flag.

## Reglas que deben conservar las migraciones

- Cita, mascota, veterinario y servicio usan UUID. `clienteId` es una **cadena opaca de identidad SWA**, no un GUID garantizado; cualquier clave interna distinta requiere un mapeo explícito.
- Guardar `inicioUtc` normalizado a UTC. La visualización usa `America/Bogota`.
- `motivo` es opcional, con máximo de 200 caracteres.
- Estados: `PROGRAMADA` y `CANCELADA`. Cancelar cambia el estado mediante `UPDATE` y conserva el historial; un CLIENTE que intenta cancelar una cita ajena recibe `404`.
- Para las franjas actuales de 30 minutos, un índice único filtrado de `(veterinario_id, inicio_utc)` para citas `PROGRAMADA` debe proteger la concurrencia. Si las duraciones cambian, revisar la regla de solapamientos.

Estas reglas siguen el [ADR-002](../docs/adr/ADR-002-datos.md). El esquema, las migraciones y las pruebas de persistencia quedan a cargo de Nicolás.
