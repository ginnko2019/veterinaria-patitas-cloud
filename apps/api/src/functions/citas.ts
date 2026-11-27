import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { obtenerUsuario } from "../auth/obtenerUsuario";
import { obtenerServicioCitas } from "../container";
import { Cita, NuevaCitaInput } from "../domain/cita";
import { CitasService } from "../services/citasService";
import {
  respuestaError,
  respuestaErrorJson,
  respuestaNoAutenticado,
} from "./http";

function esObjeto(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tieneEstructuraCrearCita(value: unknown): value is NuevaCitaInput {
  return (
    esObjeto(value) &&
    typeof value.mascotaId === "string" &&
    typeof value.veterinarioId === "string" &&
    typeof value.servicioId === "string" &&
    typeof value.inicioUtc === "string" &&
    (value.motivo === undefined || typeof value.motivo === "string")
  );
}

function citaPublica(cita: Cita): Omit<Cita, "clienteId"> {
  const { clienteId, ...respuesta } = cita;
  return respuesta;
}

function obtenerIdCita(request: HttpRequest): string | null {
  const id = request.params.id;
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id
    )
    ? id
    : null;
}

export async function postCita(
  request: HttpRequest,
  context: InvocationContext,
  servicio?: CitasService
): Promise<HttpResponseInit> {
  const usuario = obtenerUsuario(request);
  if (!usuario) return respuestaNoAutenticado();

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return respuestaError(error, "/api/citas", context);
  }

  if (!tieneEstructuraCrearCita(body)) {
    return respuestaErrorJson(
      "CAMPOS_OBLIGATORIOS",
      "El cuerpo no tiene la estructura requerida para crear una cita.",
      400
    );
  }

  try {
    const servicioCitas = servicio ?? obtenerServicioCitas();
    const input: NuevaCitaInput = {
      mascotaId: body.mascotaId,
      veterinarioId: body.veterinarioId,
      servicioId: body.servicioId,
      inicioUtc: body.inicioUtc,
      motivo: body.motivo,
    };
    const creada = await servicioCitas.crearCita(input, usuario);
    return { status: 201, jsonBody: citaPublica(creada) };
  } catch (error) {
    return respuestaError(error, "/api/citas", context);
  }
}

export async function getCitas(
  request: HttpRequest,
  context: InvocationContext,
  servicio?: CitasService
): Promise<HttpResponseInit> {
  const usuario = obtenerUsuario(request);
  if (!usuario) return respuestaNoAutenticado();

  try {
    const servicioCitas = servicio ?? obtenerServicioCitas();
    return {
      status: 200,
      jsonBody: (await servicioCitas.listarCitas(usuario)).map(citaPublica),
    };
  } catch (error) {
    return respuestaError(error, "/api/citas", context);
  }
}

export async function patchCancelarCita(
  request: HttpRequest,
  context: InvocationContext,
  servicio?: CitasService
): Promise<HttpResponseInit> {
  const usuario = obtenerUsuario(request);
  if (!usuario) return respuestaNoAutenticado();

  const id = obtenerIdCita(request);
  if (!id) {
    return respuestaErrorJson(
      "ID_INVALIDO",
      "El id de la cita debe ser un UUID válido.",
      400
    );
  }

  try {
    const servicioCitas = servicio ?? obtenerServicioCitas();
    const cancelada = await servicioCitas.cancelarCita(id, usuario);
    return { status: 200, jsonBody: citaPublica(cancelada) };
  } catch (error) {
    return respuestaError(error, "/api/citas/{id}/cancelar", context);
  }
}

app.http("citas-crear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "citas",
  handler: postCita,
});

app.http("citas-listar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "citas",
  handler: getCitas,
});

app.http("citas-cancelar", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "citas/{id}/cancelar",
  handler: patchCancelarCita,
});
