# Publicacion de la API DEV

Propuesta de codigo; no acredita un despliegue. El aprovisionamiento real de la
Function y de SQL sigue siendo requisito. No ejecutar mientras falte la Function
Y1/Node 22 o Azure bloquee la cuota/region del entorno.

## Ejecucion y permisos

El workflow `Publicar API DEV` compila, prueba y empaqueta Node 22. Solo publica
mediante `workflow_dispatch` desde `main`, en el Environment `dev`. Comparte
`concurrency: terraform-dev` con Terraform para evitar cambios simultaneos.
Usa las variables existentes `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`, `TF_NAME_SUFFIX` y `TF_RESOURCE_GROUP_ID`; no requiere
secrets de GitHub ni publish profiles. El login utiliza la credencial OIDC ya
preparada para `environment:dev`.

El SP necesita el `Contributor` ya concedido en `rg-patitas-dev`: consulta la
Function, su plan, SWA y Storage; crea/reutiliza un contenedor privado y actualiza
un app setting. La subida del blob usa temporalmente la conexion
`AzureWebJobsStorage` existente, obtenida por ARM, sin guardarla en GitHub. No se
asignan roles nuevos ni se cambia el almacenamiento operativo de la Function.

Antes de integrar el workflow, Terraform debe preservar **solo**
`app_settings["WEBSITE_RUN_FROM_PACKAGE"]` en `ignore_changes`, junto a su
excepcion AuthV2 actual. El publicador comprueba esa declaracion antes del login.
No ignorar todo `app_settings`: Terraform sigue administrando SQL y la confianza.

## Paquete, credenciales y caducidad

El ZIP contiene `host.json`, manifests npm, `dist` y dependencias de produccion.
No incluye `local.settings.json`, el repositorio ni los tests. El publicador usa
`function-releases` en el Storage operativo existente, siempre privado, y un blob
nuevo por commit/ejecucion. No elimina ni sobrescribe paquetes anteriores.

Se genera un SAS **solo lectura, solo HTTPS, por 30 dias** y se guarda unicamente
en `WEBSITE_RUN_FROM_PACKAGE` dentro de Azure. La URL y las credenciales quedan
fuera de logs, artifacts y outputs GitHub. Los errores conservan un diagnostico
saneado. El archivo temporal del unico setting se crea con modo 0600 y se borra.

**Volver a publicar antes de la fecha `package_expires_utc` del resumen.** No hay
renovacion automatica en este incremento; al caducar el SAS, un arranque/reciclado
puede no cargar el paquete. Para volver a una revision anterior, preparar un
commit revertido revisado en `main` y publicar de nuevo. No modificar manualmente
el SAS ni recuperar credenciales desde el log.

La carga usa comandos oficiales Azure CLI y el mecanismo de paquete externo de
Linux Consumption. Se evita invocar directamente `functions-action@v1` porque
su ruta de error al actualizar settings incluye la URL SAS; esa accion genera
un SAS de un ano. La ruta `config-zip` de Azure CLI consultada genera 520 semanas.
Este script limita expresamente la vigencia a 30 dias, sin cambiar Y1 ni costos
de hosting. La alternativa de paquete con MI requeriria permisos Blob y otro
bootstrap, fuera de este incremento.

## Verificacion y SQL posterior

Para la primera publicacion, mantener `TRUST_SWA_PRINCIPAL=false` y completar la
configuracion SQL DEV. El publicador acepta solo los strings `true` o `false` y
conserva el valor existente: los redeploys pueden preservar `true` despues de su
activacion revisada. El resumen informa el valor observado. Solo cambia la URL
del paquete; nunca activa la confianza. Despues de publicar y sincronizar triggers,
el workflow exige siempre `test:seguridad:azure`: health correcto
por SWA y acceso directo rechazado con/sin identidad falsificada. Una prueba
omitida, un 404 o un error de red no acreditan aislamiento. Si ese gate falla,
el workflow falla; el paquete puede haber quedado instalado y la confianza conserva
su valor previo. No hay rollback automatico.

SQL requiere, por separado, IPs revisadas de Function/administrador, el usuario
SQL de la identidad administrada **de la Function**, migracion y catalogos, y la
carga parametrizada de cliente/mascota con el `userId` SWA real. Seguir
[database/README.md](../database/README.md). `test:sql:azure` utiliza una identidad
de pruebas con limpieza separada; no acredita por si solo la identidad desplegada.
Health no consulta SQL. La primera activacion de confianza y la verificacion de
sesiones/CRUD/persistencia requieren un cambio separado revisado. Cada redeploy
conserva esa configuracion y repite el gate de aislamiento.

## Fuentes primarias consultadas

- [OIDC con Azure Login](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended).
- [Paquetes en Functions y Linux Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/deployment-zip-push).
- [SAS de blobs con permisos y expiracion explicitos](https://learn.microsoft.com/en-us/cli/azure/storage/blob#az-storage-blob-generate-sas).
- [Sincronizacion ARM de triggers](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/sync-function-triggers?view=rest-appservice-2024-11-01).
- [Implementacion consultada de Functions Action](https://github.com/Azure/functions-action/blob/6642d253e29c8c3c5ebe4d6115069acd17e381cf/src/publishers/websiteRunFromPackageDeploy.ts).
- [Implementacion consultada de Azure CLI](https://github.com/Azure/azure-cli/blob/c2569c88758233b17033f943b21ae5b70e8d992e/src/azure-cli/azure/cli/command_modules/appservice/custom.py#L2258).
