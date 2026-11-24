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
- Los métodos de citas exigen un token de acceso suministrado por una futura capa de autenticación.
- No se publican operaciones privadas sin autorización ni se simula persistencia.
- Las llamadas de React se habilitarán cuando Nicolás confirme el contrato de datos y se complete la autenticación.

Si el backend está apagado o VITE_API_BASE_URL no está configurada, el portal muestra un estado informativo en vez de inventar datos.

## Siguiente incremento

Catálogos reales, autenticación, agenda de citas, pruebas automatizadas y pipeline CI.
