import { HttpRequest, InvocationContext } from "@azure/functions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { obtenerUsuario } from "../auth/obtenerUsuario";
import { obtenerServicioCitas } from "../container";
import { getCitas, patchCancelarCita, postCita } from "../functions/citas";
import { getServicios } from "../functions/servicios";
import { getVeterinarios } from "../functions/veterinarios";

const CLIENTE_ID = "cliente-a";
const INICIO = "2030-12-03T15:00:00Z";
const UUID_CITA = "10000000-0000-4000-8000-000000000001";

function requestConPrincipal(
  userId: string,
  userRoles: string[],
  body?: unknown,
  params: Record<string, string> = {}
): HttpRequest {
  const principal = Buffer.from(
    JSON.stringify({ userId, userRoles }),
    "utf8"
  ).toString("base64");
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-ms-client-principal" ? principal : null,
    },
    params,
    json: async () => body,
  } as unknown as HttpRequest;
}

function requestAutenticado(body?: unknown): HttpRequest {
  return requestConPrincipal(CLIENTE_ID, ["authenticated"], body);
}

const contextoMock = {
  error: vi.fn(),
};
const contexto = contextoMock as unknown as InvocationContext;

const citaInput = {
  mascotaId: "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
  veterinarioId: "6baec109-23fc-4715-9154-9ab1a86f436f",
  servicioId: "5b442a3a-8a08-4760-82d9-97e67971c7bf",
  inicioUtc: INICIO,
};

describe("seguridad de identidad y persistencia", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    ["sin definir", undefined],
    ["con un valor distinto de true", "false"],
  ])("rechaza el principal falsificado si TRUST_SWA_PRINCIPAL está %s", async (_, trust) => {
    if (trust === undefined) {
      vi.stubEnv("TRUST_SWA_PRINCIPAL", undefined);
    } else {
      vi.stubEnv("TRUST_SWA_PRINCIPAL", trust);
    }

    const request = requestConPrincipal(
      "atacante-falso",
      ["anonymous", "authenticated", "ADMIN"],
      citaInput,
      { id: UUID_CITA }
    );
    expect(obtenerUsuario(request)).toBeNull();

    const respuestas = await Promise.all([
      getVeterinarios(request, contexto),
      getServicios(request, contexto),
      getCitas(request, contexto),
      postCita(request, contexto),
      patchCancelarCita(request, contexto),
    ]);
    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
  });

  it("mantiene las respuestas autenticadas cuando la infraestructura es confiable", async () => {
    vi.stubEnv("TRUST_SWA_PRINCIPAL", "true");
    vi.stubEnv("PERSISTENCE", "memory");
    vi.stubEnv("APP_ENV", "local");

    const catalogos = requestAutenticado();
    const veterinarios = await getVeterinarios(catalogos, contexto);
    const servicios = await getServicios(catalogos, contexto);
    const listado = await getCitas(catalogos, contexto);
    const creada = await postCita(
      requestAutenticado(citaInput),
      contexto
    );
    const id = (creada.jsonBody as { id: string }).id;
    const cancelada = await patchCancelarCita(
      requestConPrincipal(CLIENTE_ID, ["authenticated"], undefined, { id }),
      contexto
    );

    expect([
      veterinarios.status,
      servicios.status,
      listado.status,
      creada.status,
      cancelada.status,
    ]).toEqual([200, 200, 200, 201, 200]);
  });

  it.each([
    ["PERSISTENCE sin definir", undefined, "local"],
    ["APP_ENV de producción", "memory", "prod"],
  ])("falla cerrado con %s", async (_, persistence, appEnv) => {
    vi.stubEnv("TRUST_SWA_PRINCIPAL", "true");
    if (persistence === undefined) {
      vi.stubEnv("PERSISTENCE", undefined);
    } else {
      vi.stubEnv("PERSISTENCE", persistence);
    }
    vi.stubEnv("APP_ENV", appEnv);
    vi.stubEnv("NODE_ENV", "production");
    contextoMock.error.mockClear();

    expect(() => obtenerServicioCitas()).toThrow("PERSISTENCIA_NO_CONFIGURADA");
    const respuesta = await getCitas(requestAutenticado(), contexto);

    expect(respuesta.status).toBe(500);
    expect(respuesta.jsonBody).toEqual({
      code: "ERROR_INTERNO",
      message: "Ocurrió un error interno.",
    });
    expect(JSON.stringify(respuesta.jsonBody)).not.toContain(
      "PERSISTENCIA_NO_CONFIGURADA"
    );
    expect(contextoMock.error).toHaveBeenCalledWith(
      "PERSISTENCIA_NO_CONFIGURADA"
    );
  });

  it.each(["prod", "dev"])("APP_ENV=%s impide memoria incluso con NODE_ENV=test", async (appEnv) => {
    vi.stubEnv("TRUST_SWA_PRINCIPAL", "true");
    vi.stubEnv("PERSISTENCE", "memory");
    vi.stubEnv("APP_ENV", appEnv);
    vi.stubEnv("NODE_ENV", "test");
    expect(() => obtenerServicioCitas()).toThrow("PERSISTENCIA_NO_CONFIGURADA");
    const respuesta = await getCitas(requestAutenticado(), contexto);
    expect(respuesta.status).toBe(500);
    expect(respuesta.jsonBody).toEqual({
      code: "ERROR_INTERNO", message: "Ocurrió un error interno.",
    });
  });

  it("permite el runner sin APP_ENV solo cuando la memoria se habilita expresamente", () => {
    vi.stubEnv("APP_ENV", undefined);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE", "memory");
    expect(() => obtenerServicioCitas()).not.toThrow();
    vi.stubEnv("PERSISTENCE", undefined);
    expect(() => obtenerServicioCitas()).toThrow("PERSISTENCIA_NO_CONFIGURADA");
  });
});
