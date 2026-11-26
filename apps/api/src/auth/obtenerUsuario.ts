import { HttpRequest } from "@azure/functions";

export interface Usuario {
  id: string;
  rol: "CLIENTE" | "ADMIN";
}

interface PrincipalStaticWebApps {
  userId: string;
  userRoles: string[];
}

export function obtenerUsuario(request: HttpRequest): Usuario | null {
  // Este encabezado SOLO es confiable si la Function no es accesible directamente
  // desde internet y recibe tráfico únicamente a través de Static Web Apps;
  // ese aislamiento debe coordinarse con la infraestructura.
  const principalCodificado = request.headers.get("x-ms-client-principal");
  if (!principalCodificado) return null;

  try {
    const principal: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(principalCodificado), (caracter) =>
          caracter.charCodeAt(0)
        )
      )
    );
    if (!principal || typeof principal !== "object") return null;

    const candidato = principal as Partial<PrincipalStaticWebApps>;
    if (
      typeof candidato.userId !== "string" ||
      candidato.userId.trim() === "" ||
      !Array.isArray(candidato.userRoles) ||
      !candidato.userRoles.every((rol) => typeof rol === "string") ||
      candidato.userRoles.indexOf("authenticated") === -1
    ) {
      return null;
    }

    return {
      id: candidato.userId,
      rol:
        candidato.userRoles.indexOf("ADMIN") !== -1 ? "ADMIN" : "CLIENTE",
    };
  } catch {
    return null;
  }
}
