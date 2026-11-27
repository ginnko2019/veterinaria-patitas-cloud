import { Cita } from "../domain/cita";
import { canonicalizarInicioUtc } from "../domain/canonicalizarInicioUtc";
import { DominioError } from "../domain/errores";
import {
  CatalogoRepository,
  CitasRepository,
  Cliente,
  Mascota,
  Servicio,
  Veterinario,
} from "./citasRepository";

// Repositorio solo para pruebas y desarrollo. Los datos se reinician con el proceso
// y no deben usarse como almacenamiento de la demo final.
export class MemoriaCitasRepository implements CitasRepository {
  private citas: Cita[] = [];
  private siguienteId = 1;

  async crear(cita: Cita): Promise<Cita> {
    const inicioUtcCanonico = canonicalizarInicioUtc(cita.inicioUtc);
    if (
      this.citas.some(
        (actual) =>
          actual.veterinarioId === cita.veterinarioId &&
          actual.inicioUtc === inicioUtcCanonico &&
          actual.estado === "PROGRAMADA"
      )
    ) {
      throw new DominioError("CONFLICTO_HORARIO", 409);
    }
    const creada = {
      ...cita,
      inicioUtc: inicioUtcCanonico,
      id: `10000000-0000-4000-8000-${(
        "000000000000" + this.siguienteId
      ).slice(-12)}`,
    };
    this.siguienteId += 1;
    this.citas.push(creada);
    return creada;
  }

  async listarPorCliente(clienteId: string): Promise<Cita[]> {
    return this.citas.filter((cita) => cita.clienteId === clienteId);
  }

  async listarTodas(): Promise<Cita[]> {
    return [...this.citas];
  }

  async obtenerPorId(id: string): Promise<Cita | undefined> {
    return this.citas.find((cita) => cita.id === id);
  }

  async cancelar(id: string): Promise<Cita | undefined> {
    const cita = this.citas.find((actual) => actual.id === id);
    if (!cita) return undefined;
    cita.estado = "CANCELADA";
    return cita;
  }
}

export class MemoriaCatalogoRepository implements CatalogoRepository {
  private clientes: Cliente[] = [
    { id: "cliente-a", identityId: "cliente-a" },
    { id: "cliente-b", identityId: "cliente-b" },
  ];

  private mascotas: Mascota[] = [
    {
      id: "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
      clienteId: "cliente-a",
      nombre: "Luna",
    },
    {
      id: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf",
      clienteId: "cliente-b",
      nombre: "Max",
    },
  ];

  private veterinarios: Veterinario[] = [
    {
      id: "6baec109-23fc-4715-9154-9ab1a86f436f",
      nombre: "Veterinaria Ana",
    },
    {
      id: "b12a9c50-fd45-4c75-9e3e-fcf8deecaf02",
      nombre: "Veterinario Luis",
    },
    {
      id: "d2e0d9c3-0be7-45f7-9b3e-2a4fd1af3ad8",
      nombre: "Veterinaria Sofia",
    },
  ];

  private servicios: Servicio[] = [
    {
      id: "5b442a3a-8a08-4760-82d9-97e67971c7bf",
      nombre: "Consulta general",
      duracionMinutos: 30,
    },
    {
      id: "1fe2c6c1-1a45-42f4-bd0b-726c4f3e1caa",
      nombre: "Vacunacion",
      duracionMinutos: 30,
    },
  ];

  async listarVeterinarios(): Promise<Veterinario[]> {
    return [...this.veterinarios];
  }

  async listarServicios(): Promise<Servicio[]> {
    return [...this.servicios];
  }

  async listarMascotasPorCliente(clienteId: string): Promise<Mascota[]> {
    return this.mascotas.filter((mascota) => mascota.clienteId === clienteId);
  }

  async obtenerMascota(id: string): Promise<Mascota | undefined> {
    return this.mascotas.find((mascota) => mascota.id === id);
  }

  async obtenerVeterinario(id: string): Promise<Veterinario | undefined> {
    return this.veterinarios.find((veterinario) => veterinario.id === id);
  }

  async obtenerServicio(id: string): Promise<Servicio | undefined> {
    return this.servicios.find((servicio) => servicio.id === id);
  }

  async obtenerClientePorIdentidad(
    identityId: string
  ): Promise<Cliente | undefined> {
    return this.clientes.find((cliente) => cliente.identityId === identityId);
  }
}
