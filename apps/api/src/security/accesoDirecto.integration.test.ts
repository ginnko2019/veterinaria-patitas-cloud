import { describe, expect, it } from "vitest";

const functionDirectUrl = process.env.FUNCTION_DIRECT_URL?.replace(/\/+$/, "");
const BASE64_PRINCIPAL = Buffer.from(
  JSON.stringify({
    userId: "usuario-inventado",
    userRoles: ["anonymous", "authenticated", "ADMIN"],
  }),
  "utf8"
).toString("base64");

// Ejecutar en el pipeline de despliegue contra la URL directa de la Function,
// no vía SWA. Si alguna ruta responde 200, el despliegue no debe continuar.
if (!functionDirectUrl) {
  console.info(
    "Prueba de acceso directo omitida: FUNCTION_DIRECT_URL no está definida."
  );
}

describe.skipIf(!functionDirectUrl)(
  "bloqueo de acceso directo a Azure Functions",
  () => {
    it("rechaza peticiones con un principal SWA falsificado", async () => {
      const base = `${functionDirectUrl}/`;
      const paths = [
        { method: "GET", path: "citas" },
        {
          method: "POST",
          path: "citas",
          body: {
            mascotaId: "f0000000-0000-4000-8000-000000000001",
            veterinarioId: "f0000000-0000-4000-8000-000000000002",
            servicioId: "f0000000-0000-4000-8000-000000000003",
            inicioUtc: "2031-12-03T15:00:00Z",
          },
        },
        {
          method: "PATCH",
          path: "citas/f0000000-0000-4000-8000-000000000004/cancelar",
        },
      ];

      for (const endpoint of paths) {
        let response: Response;
        try {
          response = await fetch(new URL(endpoint.path, base), {
            method: endpoint.method,
            headers: {
              "x-ms-client-principal": BASE64_PRINCIPAL,
              ...(endpoint.body ? { "content-type": "application/json" } : {}),
            },
            body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
            signal: AbortSignal.timeout(10000),
          });
        } catch {
          continue;
        }

        expect([401, 403, 404]).toContain(response.status);
        const content = await response.text();
        expect(content).not.toMatch(
          /"(mascotaId|veterinarioId|servicioId|inicioUtc|estado)"\s*:/
        );
      }
    });
  }
);
