import { HttpRequest } from "@azure/functions";

export interface Usuario {
  id: string;
  rol: "CLIENTE" | "ADMIN";
}

interface PrincipalStaticWebApps {
  userId: string;
  userRoles: string[];
}

let avisoIdentidadNoConfiableRegistrado = false;

// TRUST_SWA_PRINCIPAL solo debe activarse cuando la infraestructura garantiza que
// la Function recibe tráfico únicamente de Static Web Apps; ADMIN debe asignarlo
// la administración de roles de SWA, nunca el cliente.
export function obtenerUsuario(request: HttpRequest): Usuario | null {
  const principalCodificado = request.headers.get("x-ms-client-principal");
  if (process.env.TRUST_SWA_PRINCIPAL !== "true") {
    if (principalCodificado && !avisoIdentidadNoConfiableRegistrado) {
      console.warn("IDENTIDAD_NO_CONFIABLE");
      avisoIdentidadNoConfiableRegistrado = true;
    }
    return null;
  }

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
