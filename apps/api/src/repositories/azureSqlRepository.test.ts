import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cita } from "../domain/cita";
import { DominioError } from "../domain/errores";
import { respuestaError } from "../functions/http";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  inputs: [] as Array<[string, unknown, unknown]>,
  poolConstructor: vi.fn(),
  getToken: vi.fn(),
  poolErrorOnConnect: undefined as Error | undefined,
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({
    getToken: mocks.getToken,
  })),
}));

vi.mock("mssql", async () => {
  const { EventEmitter } = await import("node:events");
  const mockMssql = {
    ConnectionPool: mocks.poolConstructor.mockImplementation(() => {
      const pool = Object.assign(new EventEmitter(), {
        connect: vi.fn(async () => {
          if (mocks.poolErrorOnConnect) {
            pool.emit("error", mocks.poolErrorOnConnect);
          }
          return pool;
        }),
        close: vi.fn().mockResolvedValue(undefined),
        request: () => {
          const request: { input: Function; query: typeof mocks.query } = {
            input: (name: string, type: unknown, value: unknown) => {
              mocks.inputs.push([name, type, value]);
              return request;
            },
            query: mocks.query,
          };
          return request;
        },
      });
      return pool;
    }),
    UniqueIdentifier: "uniqueidentifier",
    DateTime2: (scale: number) => `datetime2(${scale})`,
    NVarChar: (length: number) => `nvarchar(${length})`,
  };
  return { ...mockMssql, default: mockMssql };
});

import { AzureSqlRepository } from "./azureSqlRepository";

const cita: Cita = {
  id: "",
  clienteId: "10000000-0000-4000-8000-000000000001",
  mascotaId: "20000000-0000-4000-8000-000000000001",
  veterinarioId: "30000000-0000-4000-8000-000000000001",
  servicioId: "40000000-0000-4000-8000-000000000001",
  inicioUtc: "2030-12-03T15:00:00.000Z",
  motivo: "motivo sintetico",
  estado: "PROGRAMADA",
};

const filaCita = {
  id: "50000000-0000-4000-8000-000000000001",
  cliente_id: cita.clienteId,
  mascota_id: cita.mascotaId,
  veterinario_id: cita.veterinarioId,
  servicio_id: cita.servicioId,
  inicio_utc: new Date("2030-12-03T15:00:00.000Z"),
  motivo: cita.motivo,
  estado: "PROGRAMADA",
};

describe("AzureSqlRepository", () => {
  const repository = new AzureSqlRepository();

  beforeEach(() => {
    vi.stubEnv("SQL_SERVER_FQDN", "unit-test.database.windows.net");
    vi.stubEnv("SQL_DATABASE_NAME", "unit-test");
    vi.stubEnv("SQL_AUTH_MODE", "managed-identity");
    mocks.getToken.mockReset();
    mocks.getToken.mockResolvedValue({
      token: "mock-token",
      expiresOnTimestamp: Date.now() + 60 * 60 * 1000,
    });
    mocks.query.mockReset();
    mocks.inputs.length = 0;
    mocks.poolErrorOnConnect = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("usa parámetros y mapea resultados con fecha UTC canónica", async () => {
    mocks.query.mockResolvedValue({ recordset: [filaCita] });

    const result = await repository.crear(cita);

    expect(result).toEqual({
      ...cita,
      id: filaCita.id,
      inicioUtc: "2030-12-03T15:00:00.000Z",
    });
    expect(mocks.query.mock.calls[0][0]).toContain("@clienteId");
    expect(mocks.query.mock.calls[0][0]).not.toContain(cita.clienteId);
    expect(mocks.poolConstructor.mock.calls[0][0]).toMatchObject({
      server: "unit-test.database.windows.net",
      database: "unit-test",
      options: { encrypt: true, trustServerCertificate: false, useUTC: true },
      authentication: {
        type: "azure-active-directory-access-token",
        options: { token: "mock-token" },
      },
    });
    expect(mocks.getToken).toHaveBeenCalledWith(
      "https://database.windows.net/.default"
    );
    expect(mocks.inputs).toEqual(
      expect.arrayContaining([
        ["clienteId", "uniqueidentifier", cita.clienteId],
        ["inicioUtc", "datetime2(0)", new Date(cita.inicioUtc)],
        ["motivo", "nvarchar(200)", cita.motivo],
      ])
    );
  });

  it("rechaza un modo SQL desconocido incluso si ya hay un pool válido", async () => {
    mocks.query.mockResolvedValue({ recordset: [] });
    await repository.listarTodas();
    mocks.query.mockClear();
    mocks.getToken.mockClear();

    vi.stubEnv("SQL_AUTH_MODE", "password");

    await expect(repository.listarTodas()).rejects.toMatchObject({
      code: "PERSISTENCIA_NO_CONFIGURADA",
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("atiende errores del pool antes de conectar y después sin exponer detalles", async () => {
    vi.stubEnv("SQL_SERVER_FQDN", "pool-errors.database.windows.net");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const errorPrivado = new Error("token, consulta y datos privados");
    mocks.poolErrorOnConnect = errorPrivado;
    mocks.query.mockResolvedValue({ recordset: [] });

    try {
      await expect(repository.listarTodas()).resolves.toEqual([]);
      const pool = mocks.poolConstructor.mock.results[
        mocks.poolConstructor.mock.results.length - 1
      ].value;
      expect(pool.listenerCount("error")).toBe(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("SQL_POOL_ERROR");

      expect(() => pool.emit("error", errorPrivado)).not.toThrow();
      await repository.listarTodas();
      expect(pool.listenerCount("error")).toBe(1);
      expect(log.mock.calls).toEqual([["SQL_POOL_ERROR"], ["SQL_POOL_ERROR"]]);
    } finally {
      log.mockRestore();
    }
  });

  it("mapea catálogos y mascotas desde las filas SQL", async () => {
    mocks.query
      .mockResolvedValueOnce({
        recordset: [{ id: cita.mascotaId, cliente_id: cita.clienteId, nombre: "Luna" }],
      })
      .mockResolvedValueOnce({
        recordset: [{ id: cita.veterinarioId, nombre: "Veterinaria Ana" }],
      })
      .mockResolvedValueOnce({
        recordset: [
          { id: cita.servicioId, nombre: "Consulta general", duracion_minutos: 30 },
        ],
      })
      .mockResolvedValueOnce({
        recordset: [{ id: cita.clienteId, identity_id: "identity-sintetica" }],
      });

    await expect(repository.obtenerMascota(cita.mascotaId)).resolves.toEqual({
      id: cita.mascotaId,
      clienteId: cita.clienteId,
      nombre: "Luna",
    });
    await expect(
      repository.obtenerVeterinario(cita.veterinarioId)
    ).resolves.toEqual({ id: cita.veterinarioId, nombre: "Veterinaria Ana" });
    await expect(repository.obtenerServicio(cita.servicioId)).resolves.toEqual({
      id: cita.servicioId,
      nombre: "Consulta general",
      duracionMinutos: 30,
    });
    await expect(
      repository.obtenerClientePorIdentidad("identity-sintetica")
    ).resolves.toEqual({
      id: cita.clienteId,
      identityId: "identity-sintetica",
    });
  });

  it.each([2601, 2627])(
    "traduce el error SQL %i a conflicto 409",
    async (number) => {
      mocks.query.mockRejectedValue({ number, message: "detalle SQL privado" });

      await expect(repository.crear(cita)).rejects.toMatchObject({
        code: "CONFLICTO_HORARIO",
        status: 409,
      });
    }
  );

  it("no consulta SQL para IDs que no son UUID", async () => {
    await expect(repository.listarPorCliente("cliente-a")).resolves.toEqual([]);
    await expect(
      repository.listarMascotasPorCliente("no-uuid")
    ).resolves.toEqual([]);
    await expect(repository.obtenerPorId("cita-no-uuid")).resolves.toBeUndefined();
    await expect(repository.obtenerMascota("no-uuid")).resolves.toBeUndefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rechaza identityId vacio o mayor a 128 caracteres sin consultar", async () => {
    await expect(
      repository.obtenerClientePorIdentidad("")
    ).resolves.toBeUndefined();
    await expect(
      repository.obtenerClientePorIdentidad("x".repeat(129))
    ).resolves.toBeUndefined();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("no expone errores SQL, consultas ni parámetros en respuesta ni logs", async () => {
    const errorInterno = Object.assign(
      new Error("mensaje SQL con query, parámetros y dato personal"),
      {
        name: "RequestError",
        number: 18456,
        code: "ELOGIN",
      }
    );
    mocks.query.mockRejectedValue(errorInterno);
    const contexto = { error: vi.fn() };
    let capturado: unknown;
    try {
      await repository.listarTodas();
    } catch (error) {
      capturado = error;
    }

    const response = respuestaError(capturado, "/api/citas", contexto as never);
    expect(response.jsonBody).toEqual({
      code: "ERROR_INTERNO",
      message: "Ocurrió un error interno.",
    });
    expect(contexto.error).toHaveBeenCalledWith(
      "ERROR_INESPERADO name=RequestError number=18456 code=ELOGIN"
    );
    expect(JSON.stringify(response.jsonBody)).not.toContain("mensaje SQL");
    expect(JSON.stringify(response.jsonBody)).not.toContain("identity-sintetica");
    const log = JSON.stringify(contexto.error.mock.calls);
    expect(log).toContain("18456");
    expect(log).not.toContain("mensaje SQL");
    expect(log).not.toContain("query, parámetros");
    expect(log).not.toContain("dato personal");
  });

  it("conserva errores de dominio en el repositorio de escritura", async () => {
    const conflict = new DominioError("CONFLICTO_HORARIO", 409);
    mocks.query.mockRejectedValue(conflict);
    await expect(repository.crear(cita)).rejects.toMatchObject({
      code: "CONFLICTO_HORARIO",
      status: 409,
    });
  });
});
