# Contrato de integración — Veterinaria Patitas

**Estado:** contrato de integración de API (#6), sesión del frontend (#8), mascotas (#10) y persistencia SQL (#11).

**Versión:** 0.3 (MVP PEMU 2026)

**Frontend:** React + TypeScript (`apps/web`)

**Backend:** Azure Functions + TypeScript (`apps/api`)

Este documento describe el código integrado en `main` mediante los PR #6, #8, #10 y #11; no acredita un despliegue en Azure ni una base de datos operativa. Todo cambio de ruta, campo o permiso debe actualizar este contrato y su consumidor.

## 1. Transporte e identidad

- Prefijo HTTP: `/api`.
- En producción, el navegador llama a la ruta relativa `/api` del mismo origen de Azure Static Web Apps (SWA), con su sesión. El cliente HTTP usa `credentials: 'same-origin'`.
- Para desarrollo, `VITE_API_BASE_URL` puede señalar una API local e incluye el sufijo `/api`. La sesión de SWA requiere el proxy/emulador o un entorno integrado; abrir Vite y Functions por separado no crea esa sesión.
- SWA autentica al usuario e incorpora `x-ms-client-principal` al reenviar la petición. El frontend consulta `/.auth/me` para presentar la sesión; no construye ese encabezado ni envía un Bearer como mecanismo de este contrato.
- Functions interpreta el principal solo con `TRUST_SWA_PRINCIPAL=true`. Antes de activarlo en Azure se debe verificar la asociación SWA–Functions, AuthV2 y el rechazo de acceso directo, siguiendo [seguridad de identidad](../seguridad-identidad.md).
- Los roles de negocio son `CLIENTE` y `ADMIN`. El backend exige el rol de plataforma `authenticated`: si además aparece `ADMIN` (mayúsculas), concede ese rol; en caso contrario trata al usuario autenticado como `CLIENTE`. `anonymous` y `authenticated` son roles de plataforma, no nuevos roles de negocio.
- La autorización y la pertenencia de mascotas/citas se comprueban en el backend. Un `clienteId` enviado por el navegador no sustituye la identidad de sesión.

## 2. Convenciones de datos

- JSON con propiedades en `camelCase`; las listas son arreglos, sin envoltorio `{data:[...]}`.
- Los identificadores de cita, mascota, veterinario y servicio son UUID expresados como cadenas.
- El `userId` de SWA es una identidad opaca y puede no ser un UUID. El backend resuelve `userId → dbo.Clientes.identity_id → Clientes.id`; no crea clientes automáticamente. En SQL el `clienteId` interno es UUID y nunca sustituye a la identidad de sesión. La consulta de mascotas por ADMIN selecciona ese identificador interno; el frontend conserva su tipo `string`.
- Fechas ISO 8601 en UTC. La API normaliza `inicioUtc`; la interfaz mostrará la zona `America/Bogota`.
- `motivo` es opcional. La respuesta pública de una cita no incluye `clienteId`.

## 3. Endpoints

| Método | Ruta | Permiso y alcance | Respuesta |
| --- | --- | --- | --- |
| GET | `/api/health` | Público a través de SWA | `200`: `{"status":"ok","service":"patitas-api"}` |
| GET | `/api/veterinarios` | Usuario autenticado | `200`: `Veterinario[]` |
| GET | `/api/servicios` | Usuario autenticado | `200`: `Servicio[]` |
| GET | `/api/mascotas` | CLIENTE: solo mascotas propias | `200`: `Mascota[]` |
| GET | `/api/mascotas?clienteId=...` | ADMIN: cliente seleccionado explícitamente | `200`: `Mascota[]` |
| POST | `/api/citas` | CLIENTE: mascota propia; ADMIN: mascota seleccionada | `201`: `Cita` |
| GET | `/api/citas` | CLIENTE: propias; ADMIN: todas | `200`: `Cita[]` |
| PATCH | `/api/citas/{id}/cancelar` | CLIENTE: propia; ADMIN: cualquiera | `200`: `Cita` cancelada |

Para mascotas, un CLIENTE ignora cualquier `clienteId` de la query y siempre recibe sus propios datos. Un ADMIN debe indicar un valor no vacío, tras quitar espacios de los extremos; de lo contrario recibe `400 CLIENTE_REQUERIDO`. Si no hay mascotas para el cliente autorizado/seleccionado, la respuesta es `[]`. Solo se exponen `id` y `nombre`.

El cliente del frontend prepara `patitasApi.mascotas()` y `patitasApi.mascotasDeCliente(clienteId)`. La futura pantalla de administración debe seleccionar un cliente válido antes de listar sus mascotas; no necesita pedir al usuario que escriba UUID manualmente.

## 4. Tipos públicos

```typescript
export type EstadoCita = 'PROGRAMADA' | 'CANCELADA';

export interface Veterinario {
  id: string;
  nombre: string;
}

export interface Servicio {
  id: string;
  nombre: string;
  duracionMinutos: number;
}

export interface Mascota {
  id: string;
  nombre: string;
}

export interface CrearCitaRequest {
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  motivo?: string;
}

export interface Cita {
  id: string;
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  motivo?: string;
  estado: EstadoCita;
}

export interface ApiError {
  code: string;
  message: string;
}
```

### Ejemplo: mascotas propias

```http
GET /api/mascotas
```

El navegador adjunta automáticamente la cookie de sesión del mismo origen.

```json
[
  {
    "id": "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
    "nombre": "Luna"
  }
]
```

### Ejemplo: registrar una cita

```http
POST /api/citas
Content-Type: application/json
```

```json
{
  "mascotaId": "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
  "veterinarioId": "6baec109-23fc-4715-9154-9ab1a86f436f",
  "servicioId": "5b442a3a-8a08-4760-82d9-97e67971c7bf",
  "inicioUtc": "2030-12-03T15:00:00Z",
  "motivo": "Consulta general"
}
```

El backend determina el propietario a partir de la mascota autorizada. El cuerpo no necesita `clienteId`.

## 5. Validaciones y errores

| Situación | HTTP | Código o comportamiento |
| --- | --- | --- |
| JSON malformado | 400 | `JSON_INVALIDO` |
| Solicitud o UUID de recurso inválido | 400 | Error de validación |
| ADMIN sin `clienteId` válido para listar mascotas | 400 | `CLIENTE_REQUERIDO` |
| Sesión ausente, principal inválido o confianza desactivada | 401 | `NO_AUTENTICADO` en el handler |
| Recurso inexistente o cita/mascota ajena a un CLIENTE | 404 | `NO_ENCONTRADA` |
| Veterinario ya reservado en el mismo inicio | 409 | `HORARIO_OCUPADO` |
| Regla de negocio incumplida, por ejemplo fecha pasada | 422 | Error de dominio |
| Error inesperado o persistencia sin configurar | 500 | `ERROR_INTERNO`, sin detalles internos |

**Cancelar una cita ajena devuelve 404**, igual que una inexistente. No se usa 403 para revelar esa diferencia. La plataforma de Azure sí puede devolver 401/403 antes de ejecutar un handler cuando rechaza acceso directo.

El código interno `CONFLICTO_HORARIO` se convierte a `HORARIO_OCUPADO` en HTTP:

```json
{
  "code": "HORARIO_OCUPADO",
  "message": "Ya existe una cita para ese veterinario en el horario solicitado."
}
```

Cancelar cambia el estado a `CANCELADA`; no borra el registro. La implementación en memoria comprueba coincidencia de veterinario e inicio. La migración SQL define un índice único filtrado para impedir reservas activas con el mismo veterinario e inicio. Su ejecución y la concurrencia deben comprobarse en DEV; los solapamientos según la duración del servicio siguen requiriendo revisión. React no puede garantizar esa regla.

## 6. Estado de integración y pendientes

1. **Autenticación:** mecanismo SWA acordado en el código. La protección real del vínculo y las sesiones debe comprobarse en Azure antes de habilitar la confianza.
2. **Persistencia:** la memoria requiere `PERSISTENCE=memory` y entorno local/test. Un `APP_ENV=dev` o `prod` explícito no permite memoria. SQL requiere `PERSISTENCE=sql`, `SQL_SERVER_FQDN`, `SQL_DATABASE_NAME` y `SQL_AUTH_MODE=managed-identity`. La conexión usa Microsoft Entra; la [guía de base de datos](../../database/README.md) distingue la identidad de la Function, las credenciales de desarrollo/pruebas y los permisos de cada una.
3. **SQL DEV:** la migración versionada, repositorio, mapeo de identidad y pruebas están en este incremento. La creación/verificación del recurso, despliegue de la migración y validación de la identidad administrada siguen dependiendo del entorno DEV.
4. **Frontend:** el PR #8 prepara sesión y cliente HTTP. El flujo completo de agenda se habilitará al integrar y verificar API, identidad y persistencia.
5. **Prueba de integración:** verificar salud, catálogos, mascotas por usuario, creación, consulta, conflicto 409, cancelación y rechazo de acceso directo. Las pruebas unitarias no sustituyen la comprobación del despliegue.
6. **Reglas pendientes:** horario definitivo de atención y catálogo real. No presentar datos sintéticos como registros persistidos ni horarios provisionales como decisiones finales.
