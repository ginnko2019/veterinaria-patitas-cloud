# Veterinaria Patitas · Frontend

Base de React + TypeScript + Vite para el proyecto final de PEMU 2026.

## Requisitos

Node.js 20.19+ o 22.12+ y npm.

## Inicio local

Desde el directorio apps/web:

1. Ejecutar `npm ci` para instalar las versiones de `package-lock.json`.
2. Copiar .env.example a .env y ajustar VITE_API_BASE_URL.
3. Ejecutar npm run dev y abrir la URL que muestra Vite.
4. Ejecutar npm run build para revisar tipos y generar dist.

No se debe subir .env ni claves de acceso. Las variables VITE_* se incorporan al JavaScript que recibe el navegador.

## Integración con Nicolás

El contrato de integración está en ../../docs/api/contrato-citas.md.

src/types/api.ts define los tipos y src/services/api.ts concentra las peticiones.

- GET /api/health es el único endpoint usado desde la interfaz inicial.
- En produccion, el cliente API usa rutas relativas `/api` y la sesion del mismo origen de Azure Static Web Apps (sin bearer tokens).
- `src/services/auth.ts` consulta `/.auth/me` solo para presentar el estado de sesion; no reemplaza la autorizacion del servidor.
- No se publican operaciones privadas sin autorización ni se simula persistencia.
- Los PR #6, #10 y #11 están integrados en `main`: endpoints de citas, `GET /api/mascotas` y repositorio SQL. El endpoint de mascotas devuelve únicamente `id` y `nombre`. La integración de código no acredita que esté desplegado ni verificado en Azure.
- `patitasApi.mascotas(signal?)` consulta las mascotas del CLIENTE autenticado, sin enviar un identificador de cliente. El backend ignora cualquier `clienteId` que intente enviar un CLIENTE.
- `patitasApi.mascotasDeCliente(clienteId, signal?)` prepara la consulta de un cliente seleccionado por ADMIN. El parámetro se recorta y codifica en la query; el backend exige `clienteId` y responde `400 CLIENTE_REQUERIDO` cuando falta. La respuesta de mascotas no contiene `clienteId`.
- Los métodos de mascotas están preparados en el cliente HTTP, pero todavía no se invocan automáticamente ni hay un selector de clientes en la interfaz. Las reservas continúan deshabilitadas.
- Antes de activar la agenda faltan el aprovisionamiento SQL DEV, la publicación del backend, la aplicación de migraciones y las comprobaciones reales en Azure: sesión, autorización, rechazo de acceso directo a Functions, concurrencia y persistencia de las citas. La confianza en la identidad de SWA solo se activa tras comprobar ese aislamiento.

En desarrollo, si el backend está apagado o `VITE_API_BASE_URL` no está configurada, el portal muestra un estado informativo. En producción, la API se consulta siempre bajo `/api` en el mismo origen de Static Web Apps.

## Publicación manual del frontend en DEV

El workflow [Publicar frontend DEV](../../.github/workflows/deploy-web-dev.yml) prepara y publica `apps/web/dist` en la Static Web App `swa-patitas-dev-<TF_NAME_SUFFIX>`, dentro de `rg-patitas-dev`. Se ejecuta manualmente desde `main`, utiliza el Environment `dev` y comparte la concurrencia `terraform-dev` con los despliegues de infraestructura y API.

Requiere que la SWA exista y que el Environment `dev` tenga `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` y `TF_NAME_SUFFIX`, con los mismos valores usados al aprovisionar DEV. La identidad federada de GitHub necesita el permiso para leer el token de despliegue de esa SWA; el rol `Contributor` ya asignado sobre `rg-patitas-dev` incluye esa operación de administración. No se necesita agregar un secreto de despliegue al repositorio ni al Environment.

El workflow compila con Node.js 22 y `npm ci`, comprueba que el artefacto conserve `staticwebapp.config.json`, inicia sesión en Azure con OIDC y obtiene el token de despliegue mediante `az staticwebapp secrets list`. El token se enmascara antes de pasarlo por una salida de paso al publicador dentro del mismo job; no se incluye en artefactos ni en el resumen. OIDC usa credenciales temporales, pero el token de despliegue SWA recuperado conserva el ciclo de vida que administra Azure: este mecanismo no lo convierte en un token efímero ni lo rota.

Para publicar, abrir **Actions → Publicar frontend DEV - Veterinaria Patitas → Run workflow**, seleccionar `main` y ejecutar. El destino es el sitio principal de la SWA de DEV, que Azure identifica como su entorno **Production**; no es el ambiente PROD del proyecto. `api_location` permanece vacío y `skip_api_build` está activado para conservar el backend Functions externo. El workflow no publica la API ni cambia AuthV2, roles, SQL o `TRUST_SWA_PRINCIPAL`.

Al terminar, el resumen muestra la URL, el commit y el resultado de una comprobación HTTP de la página. Esa comprobación no acredita la sesión ni el funcionamiento de la agenda. La presencia del workflow en el repositorio tampoco acredita que se haya ejecutado. Para volver a una versión anterior del frontend, revertir el cambio correspondiente mediante un PR revisado a `main` y ejecutar de nuevo este workflow.

Referencias: [OIDC con Azure Login](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect), [obtención del token SWA](https://learn.microsoft.com/en-us/azure/static-web-apps/static-web-apps-cli-deploy), [ciclo de vida del token de despliegue](https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management), [publicación de un artefacto compilado](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration), [Functions externo vinculado](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own) y [permisos de Contributor](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#contributor).

## Sesión real y alcance de la demo

La pantalla actual permite comprobar la página, iniciar sesión con Microsoft mediante `/.auth/login/aad`, consultar el estado de sesión mediante `/.auth/me` y ver la salud de la API. Todavía no presenta un formulario ni un listado de citas.

Para probar operaciones privadas, verificar primero el vínculo SWA–Functions, AuthV2 y el rechazo de acceso directo, siguiendo [la guía de identidad](../../docs/seguridad-identidad.md). La activación de la confianza en SWA y la preparación de SQL corresponden a sus cambios revisados; publicar React no habilita esas condiciones.

Un usuario con el rol de plataforma `authenticated` y sin `ADMIN` se trata como CLIENTE en el backend. Necesita una fila en `Clientes` cuyo `identity_id` corresponda a su `userId` real de SWA, además de una mascota vinculada; el inicio de sesión no crea esos datos. La [guía de base de datos](../../database/README.md) explica su carga parametrizada en DEV. Para ejercer administración, la sesión debe contener el rol exacto `ADMIN`; el propietario de Azure o del repositorio no recibe ese rol de aplicación automáticamente.

La próxima interfaz de CLIENTE necesita cargar mascotas y catálogos autorizados, elegir mascota/veterinario/servicio, convertir la fecha de `America/Bogota` a UTC, crear y consultar citas, y cancelar con manejo de errores de sesión, propiedad, horario ocupado y validación. Los métodos HTTP ya están preparados. La consulta administrativa de mascotas requiere seleccionar el UUID interno del cliente; el contrato actual no incluye un catálogo de clientes para construir ese selector. Ese flujo de administración requiere una decisión posterior de contrato y datos.

## Siguiente incremento

Ejecutar los despliegues revisados de frontend y backend, preparar SQL en DEV, verificar el acceso real y después habilitar la selección de mascota y la agenda. La CI ya comprueba tipos, compilación y pruebas del backend; el frontend utiliza instalación reproducible con `npm ci`.
