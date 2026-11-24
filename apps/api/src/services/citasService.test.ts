import { describe, expect, it } from "vitest";
import { NuevaCitaInput } from "../domain/cita";
import { DominioError } from "../domain/errores";
import {
  MemoriaCatalogoRepository,
  MemoriaCitasRepository,
} from "../repositories/memoriaRepository";
import { CitasService, UsuarioAutenticado } from "./citasService";

const ahora = new Date("2026-11-24T12:00:00Z");
const clienteA: UsuarioAutenticado = { id: "cliente-a", rol: "CLIENTE" };
const clienteB: UsuarioAutenticado = { id: "cliente-b", rol: "CLIENTE" };
const admin: UsuarioAutenticado = { id: "admin", rol: "ADMIN" };

const base: NuevaCitaInput = {
  mascotaId: "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
  veterinarioId: "6baec109-23fc-4715-9154-9ab1a86f436f",
  servicioId: "5b442a3a-8a08-4760-82d9-97e67971c7bf",
  inicioUtc: "2026-12-01T15:00:00Z",
  motivo: "Consulta general",
};

function crearServicio(): CitasService {
  return new CitasService(
    new MemoriaCitasRepository(),
    new MemoriaCatalogoRepository()
  );
}

function esperarCodigo(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Se esperaba DominioError");
  } catch (error) {
    expect(error).toBeInstanceOf(DominioError);
    expect((error as DominioError).code).toBe(code);
  }
}

describe("CitasService", () => {
  it("crea una cita valida", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    expect(cita.clienteId).toBe("cliente-a");
    expect(cita.estado).toBe("PROGRAMADA");
  });

  it("rechaza doble reserva", () => {
    const servicio = crearServicio();
    servicio.crearCita(base, clienteA, ahora);
    esperarCodigo(
      () => servicio.crearCita(base, clienteA, ahora),
      "CONFLICTO_HORARIO"
    );
  });

  it("cancelar libera la franja y permite reservar de nuevo", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    const cancelada = servicio.cancelarCita(cita.id, clienteA);
    expect(cancelada.estado).toBe("CANCELADA");
    expect(() => servicio.crearCita(base, clienteA, ahora)).not.toThrow();
  });

  it("el cliente A no ve citas del cliente B", () => {
    const servicio = crearServicio();
    const mascotaB = {
      ...base,
      mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf",
    };
    servicio.crearCita(mascotaB, clienteB, ahora);

    expect(servicio.listarCitas(clienteA)).toEqual([]);
  });

  it("el ADMIN ve todas las citas", () => {
    const servicio = crearServicio();
    servicio.crearCita(base, clienteA, ahora);
    servicio.crearCita(
      {
        ...base,
        mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf",
        veterinarioId: "b12a9c50-fd45-4c75-9e3e-fcf8deecaf02",
      },
      clienteB,
      ahora
    );

    expect(servicio.listarCitas(admin)).toHaveLength(2);
  });

  it("cancelar una cita ajena falla", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    esperarCodigo(
      () => servicio.cancelarCita(cita.id, clienteB),
      "NO_ENCONTRADA"
    );
  });

  it("rechaza mascota de otro cliente", () => {
    const servicio = crearServicio();
    esperarCodigo(
      () =>
        servicio.crearCita(
          {
            ...base,
            mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf",
          },
          clienteA,
          ahora
        ),
      "NO_ENCONTRADA"
    );
  });

  it("ignora clienteId enviado en el input", () => {
    const servicio = crearServicio();
    const input = {
      ...base,
      clienteId: "cliente-b",
    };
    const cita = servicio.crearCita(input, clienteA, ahora);
    expect(cita.clienteId).toBe("cliente-a");
  });
});
