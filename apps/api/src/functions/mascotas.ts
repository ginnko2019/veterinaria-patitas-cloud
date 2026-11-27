import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { obtenerUsuario } from "../auth/obtenerUsuario";
import { obtenerServicioCitas } from "../container";
import { Mascota } from "../repositories/citasRepository";
import { CitasService } from "../services/citasService";
import { respuestaError, respuestaNoAutenticado } from "./http";

function mascotaPublica(mascota: Mascota): { id: string; nombre: string } {
  return { id: mascota.id, nombre: mascota.nombre };
}

export async function getMascotas(
  request: HttpRequest,
  context: InvocationContext,
  servicio?: CitasService
): Promise<HttpResponseInit> {
  const usuario = obtenerUsuario(request);
  if (!usuario) return respuestaNoAutenticado();

  try {
    const servicioCitas = servicio ?? obtenerServicioCitas();
    const clienteId = request.query.get("clienteId") ?? undefined;
    return {
      status: 200,
      jsonBody: servicioCitas
        .listarMascotas(usuario, clienteId)
        .map(mascotaPublica),
    };
  } catch (error) {
    return respuestaError(error, "/api/mascotas", context);
  }
}

app.http("mascotas", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "mascotas",
  handler: getMascotas,
});
