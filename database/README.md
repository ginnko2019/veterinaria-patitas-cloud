# Scripts de base de datos

Ejecutar en este orden, contra la base DEV:

1. `migrations/001_init.sql`: crea tablas, claves, índices y la restricción de
   exclusión de reservas activas.
2. `seeds/001_catalogos_dev.sql`: carga/actualiza los catálogos sintéticos.
3. Opcionalmente `seeds/002_cliente_demo.template.sql`: crea un cliente y una
   mascota de prueba con identidad y nombres proporcionados al ejecutar.

La migración la ejecuta la **identidad de despliegue**, con permisos para crear
tablas, restricciones e índices. Debe ser distinta de la identidad administrada
de lectura/escritura usada por la API; a esta última solo se le deben conceder
`db_datareader` y `db_datawriter`.

Los seeds pueden ejecutarse con `sqlcmd` desde esta carpeta. El seed del catálogo:

```powershell
sqlcmd -S $env:SQL_SERVER -d $env:SQL_DATABASE -G -i .\seeds\001_catalogos_dev.sql
```

Para el cliente demo, asignar los valores localmente en variables de entorno y
pasarlos como variables SQLCMD (no guardar los valores reales en el repositorio):

```powershell
sqlcmd -S $env:SQL_SERVER -d $env:SQL_DATABASE -G `
  -v IDENTITY_ID="$env:DEMO_IDENTITY_ID" `
     NOMBRE_CLIENTE="$env:DEMO_NOMBRE_CLIENTE" `
     NOMBRE_MASCOTA="$env:DEMO_NOMBRE_MASCOTA" `
  -i .\seeds\002_cliente_demo.template.sql
```

Nunca se versionan identidades reales, nombres reales ni secretos. No incluir
datos personales en los scripts. Los valores del seed del catálogo son
sintéticos y coinciden con el repositorio en memoria.

## Prueba de integración contra DEV

Después de aplicar la migración y el seed de catálogos, configura localmente
`SQL_SERVER` y `SQL_DATABASE` para la base DEV. La identidad de ejecución de
PowerShell debe poder autenticarse con `DefaultAzureCredential` y tener
`db_datareader`/`db_datawriter`. Desde `apps/api`, ejecuta:

```powershell
$env:SQL_SERVER = "servidor-dev.database.windows.net"
$env:SQL_DATABASE = "base-dev"
npm test -- src/repositories/azureSql.integration.test.ts
```

La suite crea datos sintéticos temporales con identificadores aleatorios y los
elimina al terminar. Si cualquiera de las variables SQL falta, Vitest omite
este archivo; para una ejecución contra DEV, verifica que aparezca como prueba
ejecutada y no omitida.
