# Contrato de integración de citas — Veterinaria Patitas

**Estado:** propuesta compartida para validación de Rodrigo y Nicolás.  
**Versión:** 0.1 (MVP PEMU 2026)  
**Frontend:** React + TypeScript (`apps/web`)  
**Backend:** Azure Functions + TypeScript (`apps/api`)

Este contrato parte del **Manual de implementación de Nicolás**, entregado para el proyecto. No declara que los endpoints ya estén implementados. Si se modifica una ruta o un campo, se debe actualizar este archivo en el mismo Pull Request que cambie la API y revisar el frontend.

## 1. Convenciones

- Prefijo HTTP de Azure Functions: `/api`.
- URL local sugerida para el backend: `http://localhost:7071/api`; en el frontend la variable `VITE_API_BASE_URL` contendrá la URL **incluido el sufijo /api**.
- Formato: JSON, con nombres de propiedades en `camelCase`.
- Identificadores: UUID expresados como cadenas.
- Tiempos: formato ISO 8601 en UTC (por ejemplo, `2026-11-19T15:00:00Z`). La interfaz mostrará la zona `America/Bogota`.
- La identidad del cliente **no se envía como campo confiable** en una petición de reserva: se obtiene y valida en el backend mediante un mecanismo de autenticación acordado por el equipo.
- Citas personales: sin exponerlas públicamente antes de implementar autenticación y autorización en servidor.

## 2. Endpoints del MVP

| Método | Ruta | Función | Resultado esperado |
| --- | --- | --- | --- |
| GET | `/api/health` | Salud del servicio | `200`: `{"status":"ok","service":"patitas-api"}` |
| GET | `/api/veterinarios` | Catálogo de veterinarios | `200`: arreglo JSON |
| GET | `/api/servicios` | Catálogo de servicios | `200`: arreglo JSON |
| POST | `/api/citas` | Crear cita propia | `201`: cita creada |
| GET | `/api/citas` | Consultar citas según identidad/rol | `200`: arreglo JSON |
| PATCH | `/api/citas/{id}/cancelar` | Cancelar cita autorizada | `200`: cita actualizada |

Las listas se devuelven como **arreglos**, no como objetos `{data:[...]}`, salvo que ambos integrantes acuerden formalmente otra versión.

## 3. Tipos de datos propuestos

Estas propiedades deben confirmarse en revisión antes de consumirlas desde React.

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

export interface CrearCitaRequest {
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  motivo: string;
}

export interface Cita {
  id: string;
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  motivo: string;
  estado: EstadoCita;
}

export interface ApiError {
  code: string;
  message: string;
}
```

La estructura de `Cita` es el **mínimo previsto** para la pantalla de agenda; el backend podrá incorporar campos adicionales que no expongan información de terceros. Los campos `nombre` y `duracionMinutos` de los catálogos también son propuestas a revisar.

### Ejemplo: registrar una cita

```http
POST /api/citas
Content-Type: application/json
Authorization: Bearer <token-autorizado>
```

```json
{
  "mascotaId": "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
  "veterinarioId": "6baec109-23fc-4715-9154-9ab1a86f436f",
  "servicioId": "5b442a3a-8a08-4760-82d9-97e67971c7bf",
  "inicioUtc": "2026-11-23T15:00:00Z",
  "motivo": "Consulta general"
}
```

El esquema de autenticación mostrado es **ilustrativo**, no una decisión implementada: el equipo debe acordar el proveedor de identidad y cómo Azure Functions valida los tokens. El frontend no debe asumir que una `Function Key` constituye autenticación de usuarios.

### Ejemplo: error de horario ocupado

```json
{
  "code": "HORARIO_OCUPADO",
  "message": "Ya existe una cita para ese veterinario en el horario solicitado."
}
```

## 4. Validaciones y respuestas

| Situación | Código HTTP |
| --- | --- |
| JSON malformado / solicitud inválida | 400 |
| Usuario no autenticado | 401 |
| Sin autorización | 403 |
| Recurso inexistente | 404 |
| Franja ya reservada | 409 |
| Regla de negocio incumplida (p. ej., fecha pasada) | 422 |
| Error inesperado | 500 sin detalles internos |

No permitir reservas solapadas por veterinario; la validación definitiva debe realizarse en la **base de datos/transacción**, no solamente en React. Los estados del MVP son `PROGRAMADA` y `CANCELADA`; cancelar no elimina el registro.

## 5. Reglas provisionales de negocio

- Una sede; tres veterinarios (datos de prueba hasta definir el catálogo).
- Atención de lunes a sábado, con franjas iniciales de 30 minutos.
- La hora de apertura y cierre **está pendiente de definir**; no codificar horarios arbitrarios como una regla definitiva.
- Guardar el instante de la cita en UTC y convertirlo a la zona local al mostrarlo.
- Permitir agendar únicamente fechas futuras y citas asociadas con mascotas autorizadas para el cliente.
- Los datos personales se gestionan en el backend; React no filtra como sustituto de autorización.

## 6. Criterio de integración Rodrigo / Nicolás

1. Nicolás revisa los tipos, rutas y ejemplos de este documento y propone cambios en un Pull Request si su implementación lo requiere.
2. Rodrigo crea un cliente HTTP único en `apps/web/src/services/api.ts` que consuma las rutas establecidas.
3. Mientras no exista una API autenticada, el frontend puede usar datos **sintéticos de demostración, identificados explícitamente como simulados**, sin afirmar que son citas persistidas.
4. Se integran frontend y API primero en DEV, y se comprueban: salud, catálogos, alta de cita, consulta autorizada, conflicto 409 y cancelación.
5. Los endpoints privados **no se publican abiertos** como solución temporal para la demostración.

**Pendiente de confirmar entre ambos:** proveedor de identidad y roles; horario definitivo; forma exacta de la respuesta de creación y cancelación; datos opcionales de veterinario/servicio/cita.
