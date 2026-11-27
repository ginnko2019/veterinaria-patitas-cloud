import { Cita } from "../domain/cita";

/**
 * Todos los valores inicioUtc intercambiados con el repositorio son ISO 8601
 * UTC canónicos; el futuro índice único SQL operará sobre ese valor.
 */
export interface CitasRepository {
  crear(cita: Cita): Promise<Cita>;
  listarPorCliente(clienteId: string): Promise<Cita[]>;
  listarTodas(): Promise<Cita[]>;
  obtenerPorId(id: string): Promise<Cita | undefined>;
  cancelar(id: string): Promise<Cita | undefined>;
}

export interface Cliente {
  id: string;
  identityId: string;
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
  listarVeterinarios(): Promise<Veterinario[]>;
  listarServicios(): Promise<Servicio[]>;
  listarMascotasPorCliente(clienteId: string): Promise<Mascota[]>;
  obtenerMascota(id: string): Promise<Mascota | undefined>;
  obtenerVeterinario(id: string): Promise<Veterinario | undefined>;
  obtenerServicio(id: string): Promise<Servicio | undefined>;
  obtenerClientePorIdentidad(identityId: string): Promise<Cliente | undefined>;
}
