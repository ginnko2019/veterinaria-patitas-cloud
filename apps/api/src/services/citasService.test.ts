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

function esperarCodigo(
  action: () => unknown,
  code: string,
  status?: number
): void {
  try {
    action();
    throw new Error("Se esperaba DominioError");
  } catch (error) {
    expect(error).toBeInstanceOf(DominioError);
    expect((error as DominioError).code).toBe(code);
    if (status !== undefined) {
      expect((error as DominioError).status).toBe(status);
    }
  }
}

describe("CitasService", () => {
  it("crea una cita valida", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    expect(cita.clienteId).toBe("cliente-a");
    expect(cita.estado).toBe("PROGRAMADA");
    expect(cita.inicioUtc).toBe("2026-12-01T15:00:00.000Z");
  });

  it("rechaza doble reserva", () => {
    const servicio = crearServicio();
    servicio.crearCita(base, clienteA, ahora);
    esperarCodigo(
      () => servicio.crearCita(base, clienteA, ahora),
      "CONFLICTO_HORARIO"
    );
  });

  it("rechaza la misma franja con offsets equivalentes en ambos ordenes", () => {
    const utcPrimero = crearServicio();
    utcPrimero.crearCita(base, clienteA, ahora);
    esperarCodigo(
      () =>
        utcPrimero.crearCita(
          { ...base, inicioUtc: "2026-12-01T10:00:00-05:00" },
          clienteA,
          ahora
        ),
      "CONFLICTO_HORARIO",
      409
    );

    const offsetPrimero = crearServicio();
    offsetPrimero.crearCita(
      { ...base, inicioUtc: "2026-12-01T10:00:00-05:00" },
      clienteA,
      ahora
    );
    esperarCodigo(
      () =>
        offsetPrimero.crearCita(
          { ...base, inicioUtc: "2026-12-01T15:00:00Z" },
          clienteA,
          ahora
        ),
      "CONFLICTO_HORARIO",
      409
    );
  });

  it("rechaza la misma franja expresada con offset UTC", () => {
    const servicio = crearServicio();
    servicio.crearCita(base, clienteA, ahora);
    esperarCodigo(
      () =>
        servicio.crearCita(
          { ...base, inicioUtc: "2026-12-01T15:00:00+00:00" },
          clienteA,
          ahora
        ),
      "CONFLICTO_HORARIO",
      409
    );
  });

  it("cancelar libera la franja y permite reservar de nuevo", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    const cancelada = servicio.cancelarCita(cita.id, clienteA);
    expect(cancelada.estado).toBe("CANCELADA");
    expect(() => servicio.crearCita(base, clienteA, ahora)).not.toThrow();
  });

  it("cancelar libera la franja para una reserva con otro offset", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, clienteA, ahora);
    servicio.cancelarCita(cita.id, clienteA);

    const nueva = servicio.crearCita(
      { ...base, inicioUtc: "2026-12-01T10:00:00-05:00" },
      clienteA,
      ahora
    );
    expect(nueva.inicioUtc).toBe("2026-12-01T15:00:00.000Z");
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

  it("asigna al cliente propietario cuando agenda un ADMIN", () => {
    const servicio = crearServicio();
    const cita = servicio.crearCita(base, admin, ahora);

    expect(cita.clienteId).toBe("cliente-a");
    expect(servicio.listarCitas(clienteA)).toEqual([cita]);
    expect(servicio.listarCitas(clienteB)).toEqual([]);
    expect(servicio.cancelarCita(cita.id, clienteA).estado).toBe("CANCELADA");
  });

  it("ADMIN recibe NO_ENCONTRADA para una mascota inexistente", () => {
    const servicio = crearServicio();
    esperarCodigo(
      () =>
        servicio.crearCita(
          {
            ...base,
            mascotaId: "90000000-0000-4000-8000-000000000001",
          },
          admin,
          ahora
        ),
      "NO_ENCONTRADA",
      404
    );
  });
});
