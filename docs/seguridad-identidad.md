# Seguridad de identidad para la API

## Amenaza

Los endpoints HTTP de Azure Functions usan `authLevel: "anonymous"`. Si la
Function puede recibir tráfico directamente, un cliente puede enviar un
encabezado `x-ms-client-principal` falsificado, incluso con los roles
`authenticated` y `ADMIN`. Ese encabezado por sí solo no demuestra la identidad
ni el rol del solicitante.

La API falla cerrado: solo interpreta el principal cuando
`TRUST_SWA_PRINCIPAL` es exactamente `"true"`. Si no, el usuario no se considera
autenticado y los endpoints privados responden 401.

## Control de infraestructura requerido

La mitigación definitiva requiere Azure Static Web Apps Standard con un linked
backend y App Service Authentication v2 configurados para que la Function solo
acepte tráfico de Static Web Apps. `TRUST_SWA_PRINCIPAL` debe activarse
únicamente en esos entornos protegidos. Para desarrollo local puede usarse la
configuración de ejemplo en `apps/api/local.settings.example.json`; ese entorno
no representa una garantía de aislamiento de una Function desplegada.

La vinculación se prepara en los PR de infraestructura. Este cambio de API no
despliega recursos ni acredita el bloqueo en Azure. Antes de activar el flag,
deben revisarse la configuración aplicada de AuthV2 y la asociación con la SWA
correcta, además de ejecutar las pruebas descritas abajo. `/api/health` no debe
excluirse de la protección de la URL directa de la Function.

## Roles e identidad

El rol `ADMIN` debe asignarse en la administración de roles de Static Web Apps.
Nunca debe aceptarse desde un encabezado o campo controlado por el usuario. La
API exige el rol `authenticated`; cuando ese rol está presente, cualquier
principal sin `ADMIN` se trata como `CLIENTE`.

El `userId` de Static Web Apps debe enlazarse con el cliente correspondiente en
la base de datos mediante la columna `identity_id`, que se incorporará en el PR
de SQL.

## Persistencia cerrada por defecto

La memoria exige `PERSISTENCE=memory` y `APP_ENV=local` o `APP_ENV=test`.
Solamente cuando `APP_ENV` está ausente se permite el runner con `NODE_ENV=test`.
Un `APP_ENV=dev` o `APP_ENV=prod` explícito impide usar memoria aunque
`NODE_ENV=test`. Sin persistencia configurada, un usuario autenticado recibe
`500 ERROR_INTERNO`, sin el detalle interno del problema. El repositorio SQL y
sus migraciones siguen pendientes; este cambio no activa esa integración.

## Pruebas de la frontera SWA / Functions

`apps/api/src/security/accesoDirecto.integration.test.ts` combina dos
comprobaciones que deben aprobar en el mismo despliegue:

1. **Ruta positiva:** `GET /api/health` a través de SWA debe devolver `200` y
   exactamente `{"status":"ok","service":"patitas-api"}`. Esto evita interpretar
   una aplicación inexistente o una página HTML como evidencia de integración.
2. **Rutas directas negadas:** la Function debe responder `401` o `403` a health
   sin identidad y con un principal ADMIN fabricado, y a los catálogos y las
   operaciones de citas con ese principal. Health es público en el código y no
   consulta `TRUST_SWA_PRINCIPAL`: si sigue abierto directamente, la prueba falla
   aunque el flag apagado haga que las citas respondan `401`.

Las variables identifican **dos orígenes diferentes** y ambas incluyen `/api`:

| Variable | Formato de ejemplo |
| --- | --- |
| `FUNCTION_DIRECT_URL` | `https://func-patitas-dev-ejemplo.azurewebsites.net/api` |
| `SWA_API_URL` | `https://ejemplo.azurestaticapps.net/api` |

Se acepta una barra final; no se aceptan credenciales, consultas ni fragmentos
en las URLs. Desde `apps/api`, con los valores reales del despliegue en el
entorno, ejecutar:

```bash
npm run test:seguridad:azure
```

Ese comando **exige las dos URLs**. La CI común (`npm test` o
`npm run test:seguridad`) omite la integración solamente cuando ninguna variable
está definida; una configuración parcial, vacía o inválida hace fallar la suite.
Las regresiones del helper usan mocks y se ejecutan sin recursos de Azure.

Cada sonda tiene un timeout HTTP de 10 segundos y un límite de prueba de 15
segundos. No sigue redirecciones. Un `404`, una redirección, una respuesta `2xx`
directa o un fallo DNS/TLS/red/timeout son fallos, no pruebas de denegación.
Las rutas están en `DIRECT_PROBES`, dentro de `azureAccessChecks.ts`, para añadir
los endpoints nuevos, incluido mascotas cuando se integre su PR.

El pipeline de despliegue debe bloquearse si el comando estricto falla. La
evidencia real sigue pendiente: las pruebas con mocks y la CI sin URLs no
demuestran AuthV2 ni aislamiento en Azure. Tampoco el health positivo prueba la
persistencia o la autorización de citas; se validarán al integrar SQL y probar
sesiones reales. No activar flags a partir de una ejecución omitida.
