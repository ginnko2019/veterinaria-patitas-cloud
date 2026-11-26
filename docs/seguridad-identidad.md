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

Este repositorio no configura ni demuestra el bloqueo de acceso directo. La
configuración y verificación de la restricción de red/autenticación de la
Function siguen pendientes de infraestructura.

## Roles e identidad

El rol `ADMIN` debe asignarse en la administración de roles de Static Web Apps.
Nunca debe aceptarse desde un encabezado o campo controlado por el usuario. La
API exige el rol `authenticated`; cuando ese rol está presente, cualquier
principal sin `ADMIN` se trata como `CLIENTE`.

El `userId` de Static Web Apps debe enlazarse con el cliente correspondiente en
la base de datos mediante la columna `identity_id`, que se incorporará en el PR
de SQL.

## Prueba de acceso directo

`apps/api/src/security/accesoDirecto.integration.test.ts` envía solicitudes
GET y POST a `/api/citas` y PATCH a `/api/citas/{id}/cancelar` directamente a la
Function con un principal falsificado. Para ejecutarla, configura
`FUNCTION_DIRECT_URL` con la URL base directa de la Function, incluido `/api`,
y ejecuta `npm run test:seguridad` desde `apps/api`. Sin la variable, Vitest
omite explícitamente la prueba de integración.

La prueba debe ejecutarse en el pipeline de despliegue contra la URL directa.
Si alguna ruta responde 200, el despliegue no debe continuar. Una respuesta
negada o un bloqueo de red/plataforma no sustituye la configuración de
infraestructura ni prueba por sí sola que esta esté correctamente aplicada.
