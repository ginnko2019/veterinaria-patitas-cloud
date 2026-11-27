import { HttpResponseInit, InvocationContext } from "@azure/functions";
import { DominioError } from "../domain/errores";

export function respuestaErrorJson(
  code: string,
  message: string,
  status: number
): HttpResponseInit {
  return { status, jsonBody: { code, message } };
}

export function respuestaJsonInvalido(): HttpResponseInit {
  return respuestaErrorJson(
    "JSON_INVALIDO",
    "El cuerpo debe contener JSON válido.",
    400
  );
}

export function respuestaNoAutenticado(): HttpResponseInit {
  return respuestaErrorJson(
    "NO_AUTENTICADO",
    "El usuario debe autenticarse.",
    401
  );
}

function logErrorInesperado(error: unknown, context?: InvocationContext): void {
  const campos =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; number?: unknown; code?: unknown })
      : {};
  const name = typeof campos.name === "string" ? campos.name : "Error";
  const detalles = [`name=${name}`];
  if (typeof campos.number === "number" || typeof campos.number === "string") {
    detalles.push(`number=${campos.number}`);
  }
  if (typeof campos.code === "number" || typeof campos.code === "string") {
    detalles.push(`code=${campos.code}`);
  }
  context?.error(`ERROR_INESPERADO ${detalles.join(" ")}`);
}

export function respuestaError(
  error: unknown,
  ruta: string,
  context?: InvocationContext
): HttpResponseInit {
  if (error instanceof DominioError) {
    const code =
      error.code === "CONFLICTO_HORARIO" ? "HORARIO_OCUPADO" : error.code;
    context?.error(`${code} ${ruta}`);
    return respuestaErrorJson(
      code,
      code === "HORARIO_OCUPADO"
        ? "Ya existe una cita para ese veterinario en el horario solicitado."
        : error.message,
      error.status
    );
  }

  if (error instanceof SyntaxError) {
    context?.error(`JSON_INVALIDO ${ruta}`);
    return respuestaJsonInvalido();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PERSISTENCIA_NO_CONFIGURADA"
  ) {
    context?.error("PERSISTENCIA_NO_CONFIGURADA");
    return respuestaErrorJson(
      "ERROR_INTERNO",
      "Ocurrió un error interno.",
      500
    );
  }

  logErrorInesperado(error, context);
  return respuestaErrorJson(
    "ERROR_INTERNO",
    "Ocurrió un error interno.",
    500
  );
}
