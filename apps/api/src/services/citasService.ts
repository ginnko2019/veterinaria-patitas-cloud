import { Cita, NuevaCitaInput } from "../domain/cita";
import { DominioError } from "../domain/errores";
import { validarCita } from "../domain/validarCita";
import {
  CatalogoRepository,
  CitasRepository,
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

  crearCita(
    input: NuevaCitaInput,
    usuario: UsuarioAutenticado,
    ahora: Date = new Date()
  ): Cita {
    validarCita(input, ahora);

    if (!this.catalogo.obtenerVeterinario(input.veterinarioId)) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (!this.catalogo.obtenerServicio(input.servicioId)) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const mascota = this.catalogo.obtenerMascota(input.mascotaId);
    if (!mascota) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (usuario.rol === "CLIENTE" && mascota.clienteId !== usuario.id) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const ocupada = this.citas.buscarActivaPorVeterinarioEInicio(
      input.veterinarioId,
      input.inicioUtc
    );
    if (ocupada) {
      throw new DominioError("CONFLICTO_HORARIO", 409);
    }

    return this.citas.crear({
      id: "",
      clienteId: usuario.id,
      mascotaId: input.mascotaId,
      veterinarioId: input.veterinarioId,
      servicioId: input.servicioId,
      inicioUtc: input.inicioUtc,
      motivo: input.motivo,
      estado: "PROGRAMADA",
    });
  }

  listarCitas(usuario: UsuarioAutenticado): Cita[] {
    if (usuario.rol === "ADMIN") {
      return this.citas.listarTodas();
    }
    return this.citas.listarPorCliente(usuario.id);
  }

  cancelarCita(id: string, usuario: UsuarioAutenticado): Cita {
    const cita = this.citas.obtenerPorId(id);

    if (!cita) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    if (usuario.rol === "CLIENTE" && cita.clienteId !== usuario.id) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    const cancelada = this.citas.cancelar(id);
    if (!cancelada) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }
    return cancelada;
  }
}
