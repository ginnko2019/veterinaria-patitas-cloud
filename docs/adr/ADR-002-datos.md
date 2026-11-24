# ADR-002 - Persistencia de citas de Veterinaria Patitas

- **Estado:** Propuesto
- **Fecha:** 2026-11-24
- **Autor:** Nicolás Toro (NicoToro25)
- **Revisor:** Rodrigo Gualtero (ginnko2019)

## Contexto

Veterinaria Patitas necesita registrar citas entre clientes, mascotas y
veterinarios. El sistema debe cumplir lo siguiente:

- Mantener relaciones entre clientes, mascotas, veterinarios, servicios y citas.
- Garantizar consistencia: un mismo veterinario no puede tener dos citas
  PROGRAMADAS en la misma franja, aunque dos solicitudes lleguen al tiempo.
- Conservar el historial: las citas se cancelan cambiando su estado
  (PROGRAMADA / CANCELADA), no se borran.
- Proteger datos personales de clientes (Ley 1581 de 2012).

Supuestos iniciales del MVP, a confirmar en el HLD: una sede, tres
veterinarios, franjas de 30 minutos, atención de lunes a sábado, horario
visible en America/Bogota y fechas almacenadas en UTC.

## Alternativas

### 1. Azure SQL Database
- Modelo relacional con claves foráneas, restricciones y transacciones.
- Permite un índice único filtrado que impide la doble reserva a nivel de base de datos.
- Soporta autenticación con identidad administrada / Microsoft Entra.
- Puede tener un costo base mayor que una opción serverless de documentos
  si no se elige un tier económico.

### 2. Azure Cosmos DB
- Modelo documental con esquema flexible y escalado horizontal.
- Útil para volúmenes altos o datos poco estructurados.
- Las restricciones de unicidad compuestas y las relaciones entre entidades
  exigen más lógica en la aplicación.
- Sobredimensionado para una sede con tres veterinarios.

## Decisión

Se propone usar **Azure SQL Database** para el MVP y la operación propuesta.
La decisión queda sujeta a validar costo del SKU, capacidad y plan de
recuperación al ejecutar la solución.

## Consecuencias

**Ventajas**
- Integridad referencial entre clientes, mascotas, veterinarios, servicios y citas.
- Control transaccional y prevención de doble reserva mediante índice único
  filtrado sobre (veterinario_id, inicio_utc) para citas PROGRAMADAS.
- Modelo claro y fácil de explicar en la sustentación.

**Costos y riesgos**
- Requiere configurar el servidor, la conexión segura y el SKU.
- El índice único solo funciona mientras todas las citas duren 30 minutos;
  si se admiten duraciones distintas habrá que rediseñar la regla con
  bloqueo o transacción por intervalos.
- Los datos personales exigen autenticación, permisos por cliente/rol, HTTPS,
  datos mínimos y logs sin información sensible.

**Mitigaciones**
- Usar un tier económico y revisar costos en la calculadora del proyecto.
- Conexión con identidad administrada, sin contraseñas en el repositorio.
- Migraciones SQL versionadas en `database/migrations/`.
- Respaldo y restauración probados antes de afirmar los objetivos de
  recuperación (RPO 24 h, RTO 4 h), que por ahora son metas, no resultados medidos.