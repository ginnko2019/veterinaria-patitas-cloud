import { Cita, NuevaCitaInput } from "../domain/cita";
import { canonicalizarInicioUtc } from "../domain/canonicalizarInicioUtc";
import { DominioError } from "../domain/errores";
import { validarCita } from "../domain/validarCita";
import {
  CatalogoRepository,
  CitasRepository,
  Mascota,
} from "../repositories/citasRepository";

export interface UsuarioAutenticado {
  id: string;
  rol: "CLIENTE" | "ADMIN";
}

export class CitasService {
  constructor(
    private citas: CitasRepository,
    private catalogo: CatalogoRepository
  ) {}

  private async resolverClienteId(
    usuario: UsuarioAutenticado
  ): Promise<string | undefined> {
    const cliente = await this.catalogo.obtenerClientePorIdentidad(usuario.id);
    return cliente?.id;
  }

  async crearCita(
    input: NuevaCitaInput,
    usuario: UsuarioAutenticado,
    ahora: Date = new Date()
  ): Promise<Cita> {
    const inicioUtc = canonicalizarInicioUtc(input.inicioUtc);
    const citaInput = { ...input, inicioUtc };
    validarCita(citaInput, ahora);

    const clienteId =
      usuario.rol === "CLIENTE"
        ? await this.resolverClienteId(usuario)
        : undefined;
    if (usuario.rol === "CLIENTE" && !clienteId) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    if (!(await this.catalogo.obtenerVeterinario(citaInput.veterinarioId))) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (!(await this.catalogo.obtenerServicio(citaInput.servicioId))) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const mascota = await this.catalogo.obtenerMascota(citaInput.mascotaId);
    if (!mascota) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (
      usuario.rol === "CLIENTE" &&
      mascota.clienteId !== clienteId
    ) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    return this.citas.crear({
      id: "",
      clienteId: mascota.clienteId,
      mascotaId: citaInput.mascotaId,
      veterinarioId: citaInput.veterinarioId,
      servicioId: citaInput.servicioId,
      inicioUtc,
      motivo: citaInput.motivo,
      estado: "PROGRAMADA",
    });
  }

  async listarCitas(usuario: UsuarioAutenticado): Promise<Cita[]> {
    if (usuario.rol === "ADMIN") {
      return this.citas.listarTodas();
    }
    const clienteId = await this.resolverClienteId(usuario);
    return clienteId ? this.citas.listarPorCliente(clienteId) : [];
  }

  async listarMascotas(
    usuario: UsuarioAutenticado,
    clienteIdSolicitado?: string
  ): Promise<Mascota[]> {
    if (usuario.rol === "ADMIN") {
      const clienteId = clienteIdSolicitado?.trim();
      if (!clienteId) {
        throw new DominioError(
          "CLIENTE_REQUERIDO",
          400,
          "El parámetro clienteId es obligatorio para ADMIN."
        );
      }
      return this.catalogo.listarMascotasPorCliente(clienteId);
    }

    const clienteId = await this.resolverClienteId(usuario);
    return clienteId ? this.catalogo.listarMascotasPorCliente(clienteId) : [];
  }

  async cancelarCita(
    id: string,
    usuario: UsuarioAutenticado
  ): Promise<Cita> {
    const cita = await this.citas.obtenerPorId(id);

    if (!cita) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (usuario.rol === "CLIENTE") {
      const clienteId = await this.resolverClienteId(usuario);
      if (!clienteId || cita.clienteId !== clienteId) {
        throw new DominioError("NO_ENCONTRADA", 404);
      }
    }

    const cancelada = await this.citas.cancelar(id);
    if (!cancelada) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    return cancelada;
  }
}
