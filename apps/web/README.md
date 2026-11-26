# Veterinaria Patitas · Frontend

Base de React + TypeScript + Vite para el proyecto final de PEMU 2026.

## Requisitos

Node.js 20.19+ o 22.12+ y npm.

## Inicio local

Desde el directorio apps/web:

1. Ejecutar npm install.
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
- Los endpoints de citas no se invocan desde la interfaz hasta que el PR #6 complete el aislamiento/validacion de identidad y quede comprobado que la URL directa de la Function rechaza cabeceras falsas.
- Para una reserva amigable falta un endpoint de mascotas por usuario (`GET /api/mascotas`), que debe implementar el backend con autorizacion.

Si el backend está apagado o VITE_API_BASE_URL no está configurada, el portal muestra un estado informativo en vez de inventar datos.

## Siguiente incremento

Catálogos reales, autenticación, agenda de citas, pruebas automatizadas y pipeline CI.
