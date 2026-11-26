import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { obtenerUsuario } from "../auth/obtenerUsuario";
import { obtenerRepositorioCatalogo } from "../container";
import { CatalogoRepository } from "../repositories/citasRepository";
import { respuestaError, respuestaNoAutenticado } from "./http";

export async function getServicios(
  request: HttpRequest,
  context: InvocationContext,
  catalogo: CatalogoRepository = obtenerRepositorioCatalogo()
): Promise<HttpResponseInit> {
  const usuario = obtenerUsuario(request);
  if (!usuario) return respuestaNoAutenticado();

  try {
    return { status: 200, jsonBody: catalogo.listarServicios() };
  } catch (error) {
    return respuestaError(error, "/api/servicios", context);
  }
}

app.http("servicios", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "servicios",
  handler: getServicios,
});
