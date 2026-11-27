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

El contrato propuesto está en ../../docs/api/contrato-citas.md.

src/types/api.ts define los tipos y src/services/api.ts concentra las peticiones.

- GET /api/health es el único endpoint usado desde la interfaz inicial.
- En produccion, el cliente API usa rutas relativas `/api` y la sesion del mismo origen de Azure Static Web Apps (sin bearer tokens).
- `src/services/auth.ts` consulta `/.auth/me` solo para presentar el estado de sesion; no reemplaza la autorizacion del servidor.
- No se publican operaciones privadas sin autorización ni se simula persistencia.
- El PR #10 incorpora `GET /api/mascotas` en `feat/nt-mascotas`, rama dependiente de `feat/nt-handlers-citas` (PR #6). El endpoint devuelve únicamente `id` y `nombre`; su implementación en esa rama no implica que esté integrado en `main` o desplegado en Azure.
- `patitasApi.mascotas(signal?)` consulta las mascotas del CLIENTE autenticado, sin enviar un identificador de cliente. El backend ignora cualquier `clienteId` que intente enviar un CLIENTE.
- `patitasApi.mascotasDeCliente(clienteId, signal?)` prepara la consulta de un cliente seleccionado por ADMIN. El parámetro se recorta y codifica en la query; el backend exige `clienteId` y responde `400 CLIENTE_REQUERIDO` cuando falta. La respuesta de mascotas no contiene `clienteId`.
- Los métodos de mascotas están preparados en el cliente HTTP, pero todavía no se invocan automáticamente ni hay un selector de clientes en la interfaz. Las reservas continúan deshabilitadas.
- Antes de activar la agenda faltan la persistencia SQL duradera, la integración de los PR del backend y las comprobaciones reales en Azure: sesión, autorización, rechazo de acceso directo a Functions, concurrencia y persistencia de las citas. La confianza en la identidad de SWA solo se activa tras comprobar ese aislamiento.

En desarrollo, si el backend está apagado o `VITE_API_BASE_URL` no está configurada, el portal muestra un estado informativo. En producción, la API se consulta siempre bajo `/api` en el mismo origen de Static Web Apps.

## Siguiente incremento

Completar la integración del backend y SQL en DEV, verificar el acceso en Azure y después habilitar la selección de mascota y la agenda. La CI ya comprueba tipos, compilación y pruebas del backend; el frontend utiliza instalación reproducible con `npm ci`.
