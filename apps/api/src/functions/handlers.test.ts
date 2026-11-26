import { HttpRequest, InvocationContext } from "@azure/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServicios } from "./servicios";
import { getVeterinarios } from "./veterinarios";
import { getMascotas } from "./mascotas";
import { getCitas, patchCancelarCita, postCita } from "./citas";
import {
  MemoriaCatalogoRepository,
  MemoriaCitasRepository,
} from "../repositories/memoriaRepository";
import { CitasService } from "../services/citasService";

const CLIENTE_A = "cliente-a";
const CLIENTE_B = "cliente-b";
const ADMIN = "administrador";
const VETERINARIO_A = "6baec109-23fc-4715-9154-9ab1a86f436f";
const VETERINARIO_B = "b12a9c50-fd45-4c75-9e3e-fcf8deecaf02";
const MASCOTA_A = "2c73eae2-d6f2-4f38-aeb8-82cb722f9328";
const MASCOTA_B = "a1df2445-3dd8-4f18-bded-12f52a7fd9bf";
const SERVICIO = "5b442a3a-8a08-4760-82d9-97e67971c7bf";
const INICIO = "2030-12-03T15:00:00Z";
const RUTA_CITA = "10000000-0000-4000-8000-000000000001";

const contexto = {
  error: vi.fn(),
} as unknown as InvocationContext;

let servicio: CitasService;
let catalogo: MemoriaCatalogoRepository;

function reiniciarRepositorios(): void {
  const citas = new MemoriaCitasRepository();
  catalogo = new MemoriaCatalogoRepository();
  servicio = new CitasService(citas, catalogo);
}

function crearRequest(
  options: {
    userId?: string;
    roles?: string[];
    body?: unknown;
    jsonError?: Error;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {}
): HttpRequest {
  const headers = new Map<string, string>();
  if (options.userId !== undefined) {
    headers.set(
      "x-ms-client-principal",
      Buffer.from(
        JSON.stringify({
          userId: options.userId,
          userRoles: options.roles ?? ["authenticated"],
        }),
        "utf8"
      ).toString("base64")
    );
  }

  return {
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    params: options.params ?? {},
    query: new URLSearchParams(options.query),
    json: async () => {
      if (options.jsonError) throw options.jsonError;
      return options.body;
    },
  } as unknown as HttpRequest;
}

function input(mascotaId = MASCOTA_A, veterinarioId = VETERINARIO_A) {
  return {
    mascotaId,
    veterinarioId,
    servicioId: SERVICIO,
    inicioUtc: INICIO,
    motivo: "Consulta general",
  };
}

function iniciarCita(
  mascotaId = MASCOTA_A,
  veterinarioId = VETERINARIO_A,
  userId = CLIENTE_A
) {
  return postCita(
    crearRequest({ userId, body: input(mascotaId, veterinarioId) }),
    contexto,
    servicio
  );
}

describe("handlers HTTP", () => {
  beforeEach(() => {
    vi.stubEnv("TRUST_SWA_PRINCIPAL", "true");
    reiniciarRepositorios();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rechaza sin autenticación todas las rutas", async () => {
    const sinUsuario = crearRequest();
    const respuestas = await Promise.all([
      getVeterinarios(sinUsuario, contexto, catalogo),
      getServicios(sinUsuario, contexto, catalogo),
      getMascotas(sinUsuario, contexto, servicio),
      postCita(sinUsuario, contexto, servicio),
      getCitas(sinUsuario, contexto, servicio),
      patchCancelarCita(
        crearRequest({ params: { id: RUTA_CITA } }),
        contexto,
        servicio
      ),
    ]);

    expect(respuestas.map((respuesta) => respuesta.status)).toEqual([
      401, 401, 401, 401, 401, 401,
    ]);
    expect(respuestas[0].jsonBody).toEqual({
      code: "NO_AUTENTICADO",
      message: "El usuario debe autenticarse.",
    });
  });

  it("rechaza un principal malformado", async () => {
    const request = {
      headers: {
        get: () => "esto-no-es-base64-json",
      },
    } as unknown as HttpRequest;
    const respuesta = await getCitas(request, contexto, servicio);

    expect(respuesta.status).toBe(401);
    expect(respuesta.jsonBody).toMatchObject({ code: "NO_AUTENTICADO" });
  });

  it("lista catálogos como arreglos para usuarios autenticados", async () => {
    const request = crearRequest({ userId: CLIENTE_A });
    const veterinarios = await getVeterinarios(request, contexto, catalogo);
    const servicios = await getServicios(request, contexto, catalogo);
    const mascotas = await getMascotas(request, contexto, servicio);

    expect(veterinarios.status).toBe(200);
    expect(Array.isArray(veterinarios.jsonBody)).toBe(true);
    expect(servicios.status).toBe(200);
    expect(Array.isArray(servicios.jsonBody)).toBe(true);
    expect(mascotas.status).toBe(200);
    expect(Array.isArray(mascotas.jsonBody)).toBe(true);
  });

  it("lista únicamente las mascotas propias de cada cliente e ignora clienteId", async () => {
    const respuestaA = await getMascotas(
      crearRequest({ userId: CLIENTE_A, query: { clienteId: CLIENTE_B } }),
      contexto,
      servicio
    );
    const respuestaB = await getMascotas(
      crearRequest({ userId: CLIENTE_B }),
      contexto,
      servicio
    );
    const mascotasA = respuestaA.jsonBody as Array<Record<string, unknown>>;
    const mascotasB = respuestaB.jsonBody as Array<Record<string, unknown>>;

    expect(mascotasA).toEqual([{ id: MASCOTA_A, nombre: "Luna" }]);
    expect(mascotasB).toEqual([{ id: MASCOTA_B, nombre: "Max" }]);
    expect(mascotasA.some((mascota) => mascota.id === MASCOTA_B)).toBe(false);
    expect(mascotasB.some((mascota) => mascota.id === MASCOTA_A)).toBe(false);
    for (const mascota of [...mascotasA, ...mascotasB]) {
      expect(Object.keys(mascota).sort()).toEqual(["id", "nombre"]);
    }
  });

  it("devuelve una lista vacía si el usuario no tiene mascotas asociadas", async () => {
    vi.spyOn(catalogo, "listarMascotasPorCliente").mockReturnValue([]);
    const respuesta = await getMascotas(
      crearRequest({ userId: "cliente-sin-mascotas" }),
      contexto,
      servicio
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.jsonBody).toEqual([]);
  });

  it("requiere clienteId para ADMIN y lista las mascotas del cliente solicitado", async () => {
    const sinCliente = await getMascotas(
      crearRequest({ userId: ADMIN, roles: ["authenticated", "ADMIN"] }),
      contexto,
      servicio
    );
    const conCliente = await getMascotas(
      crearRequest({
        userId: ADMIN,
        roles: ["authenticated", "ADMIN"],
        query: { clienteId: CLIENTE_B },
      }),
      contexto,
      servicio
    );

    expect(sinCliente.status).toBe(400);
    expect(sinCliente.jsonBody).toEqual({
      code: "CLIENTE_REQUERIDO",
      message: "El parámetro clienteId es obligatorio para ADMIN.",
    });
    expect(conCliente.status).toBe(200);
    expect(conCliente.jsonBody).toEqual([{ id: MASCOTA_B, nombre: "Max" }]);
  });

  it("permite agendar usando el id listado y rechaza una mascota ajena", async () => {
    const listado = await getMascotas(
      crearRequest({ userId: CLIENTE_A }),
      contexto,
      servicio
    );
    const mascotaId = (listado.jsonBody as Array<{ id: string }>)[0].id;
    const creada = await postCita(
      crearRequest({ userId: CLIENTE_A, body: input(mascotaId) }),
      contexto,
      servicio
    );
    const ajena = await postCita(
      crearRequest({ userId: CLIENTE_A, body: input(MASCOTA_B) }),
      contexto,
      servicio
    );

    expect(creada.status).toBe(201);
    expect(ajena.status).toBe(404);
  });

  it("rechaza JSON inválido y estructuras que no sean objetos válidos", async () => {
    const invalido = await postCita(
      crearRequest({
        userId: CLIENTE_A,
        jsonError: new SyntaxError("no incluir este detalle"),
      }),
      contexto,
      servicio
    );
    const arreglo = await postCita(
      crearRequest({ userId: CLIENTE_A, body: [] }),
      contexto,
      servicio
    );

    expect(invalido.status).toBe(400);
    expect(invalido.jsonBody).toMatchObject({ code: "JSON_INVALIDO" });
    expect(arreglo.status).toBe(400);
  });

  it("crea una cita en 201, ignora clienteId y devuelve UTC canónico", async () => {
    const respuesta = await postCita(
      crearRequest({
        userId: CLIENTE_A,
        body: { ...input(), clienteId: CLIENTE_B },
      }),
      contexto,
      servicio
    );

    expect(respuesta.status).toBe(201);
    expect(respuesta.jsonBody).toMatchObject({
      inicioUtc: "2030-12-03T15:00:00.000Z",
      estado: "PROGRAMADA",
    });
    expect(respuesta.jsonBody).not.toHaveProperty("clienteId");
  });

  it("devuelve 409 para una doble reserva y 422 para una fecha pasada", async () => {
    await iniciarCita();
    const duplicada = await iniciarCita();
    const pasada = await postCita(
      crearRequest({
        userId: CLIENTE_A,
        body: { ...input(), inicioUtc: "2020-12-01T15:00:00Z" },
      }),
      contexto,
      servicio
    );

    expect(duplicada.status).toBe(409);
    expect(duplicada.jsonBody).toMatchObject({ code: "HORARIO_OCUPADO" });
    expect(pasada.status).toBe(422);
  });

  it("filtra las citas por cliente y permite al ADMIN ver todas", async () => {
    await iniciarCita(MASCOTA_A, VETERINARIO_A, CLIENTE_A);
    await iniciarCita(MASCOTA_B, VETERINARIO_B, CLIENTE_B);

    const citasA = await getCitas(
      crearRequest({ userId: CLIENTE_A }),
      contexto,
      servicio
    );
    const todas = await getCitas(
      crearRequest({ userId: ADMIN, roles: ["authenticated", "ADMIN"] }),
      contexto,
      servicio
    );

    expect(citasA.jsonBody).toHaveLength(1);
    expect(todas.jsonBody).toHaveLength(2);
    expect(
      (todas.jsonBody as Array<Record<string, unknown>>).every(
        (cita) => !("clienteId" in cita)
      )
    ).toBe(true);
  });

  it("rechaza cancelar cita ajena como 404 y valida UUID de la ruta", async () => {
    const creada = await iniciarCita();
    const id = (creada.jsonBody as { id: string }).id;
    const ajena = await patchCancelarCita(
      crearRequest({ userId: CLIENTE_B, params: { id } }),
      contexto,
      servicio
    );
    const uuidInvalido = await patchCancelarCita(
      crearRequest({ userId: CLIENTE_A, params: { id: "cita-1" } }),
      contexto,
      servicio
    );

    expect(ajena.status).toBe(404);
    expect(uuidInvalido.status).toBe(400);
  });

  it("cancelar libera la franja para otra reserva", async () => {
    const creada = await iniciarCita();
    const id = (creada.jsonBody as { id: string }).id;
    const cancelada = await patchCancelarCita(
      crearRequest({ userId: CLIENTE_A, params: { id } }),
      contexto,
      servicio
    );
    const siguienteReserva = await iniciarCita();

    expect(cancelada.status).toBe(200);
    expect(cancelada.jsonBody).toMatchObject({ estado: "CANCELADA" });
    expect(siguienteReserva.status).toBe(201);
  });

  it("oculta detalles de errores inesperados y registra solo código y ruta", async () => {
    vi.spyOn(servicio, "listarCitas").mockImplementation(() => {
      throw new Error("dato-personal-y-detalle-interno");
    });

    const respuesta = await getCitas(
      crearRequest({ userId: CLIENTE_A }),
      contexto,
      servicio
    );

    expect(respuesta.status).toBe(500);
    expect(respuesta.jsonBody).toEqual({
      code: "ERROR_INTERNO",
      message: "Ocurrió un error interno.",
    });
    expect(JSON.stringify(respuesta.jsonBody)).not.toContain(
      "dato-personal-y-detalle-interno"
    );
    expect(contexto.error).toHaveBeenCalledWith("ERROR_INTERNO /api/citas");
  });
});
