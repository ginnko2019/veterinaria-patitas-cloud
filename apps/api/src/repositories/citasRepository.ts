import { Cita } from "../domain/cita";

/**
 * Todos los valores inicioUtc intercambiados con el repositorio son ISO 8601
 * UTC canónicos; el futuro índice único SQL operará sobre ese valor.
 */
export interface CitasRepository {
  crear(cita: Cita): Cita;
  listarPorCliente(clienteId: string): Cita[];
  listarTodas(): Cita[];
  obtenerPorId(id: string): Cita | undefined;
  cancelar(id: string): Cita | undefined;
  buscarActivaPorVeterinarioEInicio(
    veterinarioId: string,
    inicioUtc: string
  ): Cita | undefined;
}

export interface Mascota {
  id: string;
  clienteId: string;
  nombre: string;
}

export interface Veterinario {
  id: string;
  nombre: string;
}

export interface Servicio {
  id: string;
  nombre: string;
  duracionMinutos: number;
}

export interface CatalogoRepository {
  listarVeterinarios(): Veterinario[];
  listarServicios(): Servicio[];
  obtenerMascota(id: string): Mascota | undefined;
  obtenerVeterinario(id: string): Veterinario | undefined;
  obtenerServicio(id: string): Servicio | undefined;
}
