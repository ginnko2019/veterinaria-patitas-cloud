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

  private resolverClienteId(usuario: UsuarioAutenticado): string {
    return usuario.id;
  }

  crearCita(
    input: NuevaCitaInput,
    usuario: UsuarioAutenticado,
    ahora: Date = new Date()
  ): Cita {
    const inicioUtc = canonicalizarInicioUtc(input.inicioUtc);
    const citaInput = { ...input, inicioUtc };
    validarCita(citaInput, ahora);

    if (!this.catalogo.obtenerVeterinario(citaInput.veterinarioId)) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (!this.catalogo.obtenerServicio(citaInput.servicioId)) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const mascota = this.catalogo.obtenerMascota(citaInput.mascotaId);
    if (!mascota) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (
      usuario.rol === "CLIENTE" &&
      mascota.clienteId !== this.resolverClienteId(usuario)
    ) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const ocupada = this.citas.buscarActivaPorVeterinarioEInicio(
      citaInput.veterinarioId,
      inicioUtc
    );
    if (ocupada) {
      throw new DominioError("CONFLICTO_HORARIO", 409);
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

  listarCitas(usuario: UsuarioAutenticado): Cita[] {
    if (usuario.rol === "ADMIN") {
      return this.citas.listarTodas();
    }
    return this.citas.listarPorCliente(this.resolverClienteId(usuario));
  }

  listarMascotas(
    usuario: UsuarioAutenticado,
    clienteIdSolicitado?: string
  ): Mascota[] {
    if (usuario.rol === "ADMIN") {
      if (!clienteIdSolicitado) {
        throw new DominioError(
          "CLIENTE_REQUERIDO",
          400,
          "El parámetro clienteId es obligatorio para ADMIN."
        );
      }
      // SUPUESTO: el criterio de gestión del ADMIN está pendiente de confirmar con Rodrigo.
      return this.catalogo.listarMascotasPorCliente(clienteIdSolicitado);
    }

    return this.catalogo.listarMascotasPorCliente(
      this.resolverClienteId(usuario)
    );
  }

  cancelarCita(id: string, usuario: UsuarioAutenticado): Cita {
    const cita = this.citas.obtenerPorId(id);

    if (!cita) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (
      usuario.rol === "CLIENTE" &&
      cita.clienteId !== this.resolverClienteId(usuario)
    ) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const cancelada = this.citas.cancelar(id);
    if (!cancelada) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    return cancelada;
  }
}
