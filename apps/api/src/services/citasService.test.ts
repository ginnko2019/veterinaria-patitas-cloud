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
const clienteDesconocido: UsuarioAutenticado = {
  id: "sin-cliente",
  rol: "CLIENTE",
};
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

async function esperarCodigo(
  action: () => Promise<unknown>,
  code: string,
  status?: number
): Promise<void> {
  try {
    await action();
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
  it("crea una cita valida", async () => {
    const cita = await crearServicio().crearCita(base, clienteA, ahora);
    expect(cita.clienteId).toBe("cliente-a");
    expect(cita.estado).toBe("PROGRAMADA");
    expect(cita.inicioUtc).toBe("2026-12-01T15:00:00.000Z");
  });

  it("rechaza doble reserva", async () => {
    const servicio = crearServicio();
    await servicio.crearCita(base, clienteA, ahora);
    await esperarCodigo(
      () => servicio.crearCita(base, clienteA, ahora),
      "CONFLICTO_HORARIO",
      409
    );
  });

  it("rechaza la misma franja con offsets equivalentes", async () => {
    const servicio = crearServicio();
    await servicio.crearCita(base, clienteA, ahora);
    await esperarCodigo(
      () =>
        servicio.crearCita(
          { ...base, inicioUtc: "2026-12-01T10:00:00-05:00" },
          clienteA,
          ahora
        ),
      "CONFLICTO_HORARIO",
      409
    );
  });

  it("cancelar libera la franja y permite reservar de nuevo", async () => {
    const servicio = crearServicio();
    const cita = await servicio.crearCita(base, clienteA, ahora);
    const cancelada = await servicio.cancelarCita(cita.id, clienteA);
    expect(cancelada.estado).toBe("CANCELADA");
    await expect(servicio.crearCita(base, clienteA, ahora)).resolves.toBeDefined();
  });

  it("el cliente A no ve citas del cliente B", async () => {
    const servicio = crearServicio();
    await servicio.crearCita(
      { ...base, mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf" },
      clienteB,
      ahora
    );
    await expect(servicio.listarCitas(clienteA)).resolves.toEqual([]);
  });

  it("el ADMIN ve todas las citas", async () => {
    const servicio = crearServicio();
    await servicio.crearCita(base, clienteA, ahora);
    await servicio.crearCita(
      {
        ...base,
        mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf",
        veterinarioId: "b12a9c50-fd45-4c75-9e3e-fcf8deecaf02",
      },
      clienteB,
      ahora
    );
    await expect(servicio.listarCitas(admin)).resolves.toHaveLength(2);
  });

  it("un usuario sin cliente asociado ve listas vacias y no puede agendar", async () => {
    const servicio = crearServicio();
    await expect(servicio.listarCitas(clienteDesconocido)).resolves.toEqual([]);
    await expect(servicio.listarMascotas(clienteDesconocido)).resolves.toEqual(
      []
    );
    await esperarCodigo(
      () => servicio.crearCita(base, clienteDesconocido, ahora),
      "NO_ENCONTRADA",
      404
    );
  });

  it("cancelar una cita ajena falla", async () => {
    const servicio = crearServicio();
    const cita = await servicio.crearCita(base, clienteA, ahora);
    await esperarCodigo(
      () => servicio.cancelarCita(cita.id, clienteB),
      "NO_ENCONTRADA"
    );
  });

  it("rechaza mascota de otro cliente", async () => {
    const servicio = crearServicio();
    await esperarCodigo(
      () =>
        servicio.crearCita(
          { ...base, mascotaId: "a1df2445-3dd8-4f18-bded-12f52a7fd9bf" },
          clienteA,
          ahora
        ),
      "NO_ENCONTRADA"
    );
  });

  it("ignora clienteId enviado en el input", async () => {
    const input = { ...base, clienteId: "cliente-b" };
    const cita = await crearServicio().crearCita(input, clienteA, ahora);
    expect(cita.clienteId).toBe("cliente-a");
  });

  it("asigna al cliente propietario cuando agenda un ADMIN", async () => {
    const servicio = crearServicio();
    const cita = await servicio.crearCita(base, admin, ahora);
    expect(cita.clienteId).toBe("cliente-a");
    await expect(servicio.listarCitas(clienteA)).resolves.toEqual([cita]);
    await expect(servicio.listarCitas(clienteB)).resolves.toEqual([]);
    await expect(
      servicio.cancelarCita(cita.id, clienteA)
    ).resolves.toMatchObject({ estado: "CANCELADA" });
  });

  it("ADMIN recibe NO_ENCONTRADA para una mascota inexistente", async () => {
    const servicio = crearServicio();
    await esperarCodigo(
      () =>
        servicio.crearCita(
          { ...base, mascotaId: "90000000-0000-4000-8000-000000000001" },
          admin,
          ahora
        ),
      "NO_ENCONTRADA",
      404
    );
  });
});
