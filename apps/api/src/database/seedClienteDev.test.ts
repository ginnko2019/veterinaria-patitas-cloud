import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const request = { input: vi.fn(), query: vi.fn() };
  const transaction = {
    on: vi.fn(), begin: vi.fn(), request: vi.fn(),
    commit: vi.fn(), rollback: vi.fn(),
  };
  const pool = { on: vi.fn(), connect: vi.fn(), close: vi.fn() };
  return {
    request, transaction, pool,
    token: vi.fn(), poolConstructor: vi.fn(), transactionConstructor: vi.fn(),
    listeners: {} as Record<string, () => void>,
  };
});

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({ getToken: mocks.token })),
}));

vi.mock("mssql", () => ({
  default: {
    ConnectionPool: mocks.poolConstructor.mockImplementation(() => mocks.pool),
    Transaction: mocks.transactionConstructor.mockImplementation(() => mocks.transaction),
    NVarChar: (length: number) => ({ type: "NVarChar", length }),
    UniqueIdentifier: "UniqueIdentifier",
    ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" },
  },
}));

import { cargarClienteDev, ClienteDevInput, SeedDevConfig } from "./seedClienteDev";

const config: SeedDevConfig = {
  server: "unit-test.database.windows.net",
  database: "patitas-dev",
  environment: "dev",
  authMode: "managed-identity",
};
const input: ClienteDevInput = {
  identityId: "identidad-sintetica-dev",
  nombreCliente: "Ana O'Connor",
  mascotaId: "10000000-0000-4000-8000-000000000001",
  nombreMascota: "D'Artagnan",
};

describe("carga parametrizada de cliente DEV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = {};
    mocks.token.mockResolvedValue({ token: "token-sintetico" });
    mocks.pool.connect.mockResolvedValue(mocks.pool);
    mocks.pool.close.mockResolvedValue(undefined);
    mocks.transaction.on.mockImplementation((event, handler) => {
      mocks.listeners[event] = handler;
      return mocks.transaction;
    });
    mocks.transaction.begin.mockResolvedValue(undefined);
    mocks.transaction.request.mockReturnValue(mocks.request);
    mocks.transaction.commit.mockResolvedValue(undefined);
    mocks.transaction.rollback.mockResolvedValue(undefined);
    mocks.request.input.mockReturnValue(mocks.request);
    mocks.request.query.mockResolvedValue({ recordset: [] });
  });

  it("conserva apostrofes y texto parecido a SQL como parametros, nunca como codigo", async () => {
    const nombre = "Ana O'Connor'); DROP TABLE dbo.Clientes;--";
    await cargarClienteDev(config, { ...input, nombreCliente: nombre });

    expect(mocks.request.input).toHaveBeenCalledWith(
      "nombreCliente", { type: "NVarChar", length: 100 }, nombre
    );
    expect(mocks.request.input).toHaveBeenCalledWith(
      "nombreMascota", { type: "NVarChar", length: 80 }, "D'Artagnan"
    );
    expect(mocks.request.input).toHaveBeenCalledWith(
      "identityId", { type: "NVarChar", length: 128 }, input.identityId
    );
    expect(mocks.request.input).toHaveBeenCalledWith(
      "mascotaId", "UniqueIdentifier", input.mascotaId
    );
    const sentSql = mocks.request.query.mock.calls[0][0] as string;
    for (const value of [nombre, input.nombreMascota, input.identityId, input.mascotaId]) {
      expect(sentSql).not.toContain(value);
    }
    expect(sentSql).toContain("@nombreCliente");
    expect(sentSql).toContain("@nombreMascota");
    expect(mocks.transaction.begin).toHaveBeenCalledWith("SERIALIZABLE");
    expect(mocks.transaction.commit).toHaveBeenCalledOnce();
    expect(mocks.transaction.rollback).not.toHaveBeenCalled();
    expect(mocks.pool.close).toHaveBeenCalledOnce();
  });

  it("revierte toda la carga si la consulta falla y no confirma una carga parcial", async () => {
    const failure = new Error("fallo sintetico al insertar la mascota");
    mocks.request.query.mockRejectedValue(failure);

    await expect(cargarClienteDev(config, input)).rejects.toBe(failure);

    expect(mocks.transaction.rollback).toHaveBeenCalledOnce();
    expect(mocks.transaction.commit).not.toHaveBeenCalled();
    expect(mocks.pool.close).toHaveBeenCalledOnce();
  });

  it("conserva el error cuando XACT_ABORT ya revirtio la transaccion", async () => {
    const failure = new Error("restriccion sintetica de SQL");
    mocks.request.query.mockImplementation(async () => {
      mocks.listeners.rollback();
      throw failure;
    });

    await expect(cargarClienteDev(config, input)).rejects.toBe(failure);

    expect(mocks.transaction.rollback).not.toHaveBeenCalled();
    expect(mocks.transaction.commit).not.toHaveBeenCalled();
    expect(mocks.pool.close).toHaveBeenCalledOnce();
  });

  it.each([
    { database: "patitas-prod" },
    { database: "otra-base" },
    { environment: "prod" },
    { environment: "test" },
    { authMode: "password" },
    { server: "localhost" },
  ])("rechaza un destino fuera de Azure SQL DEV antes de autenticarse: %j", async (override) => {
    await expect(cargarClienteDev({ ...config, ...override }, input))
      .rejects.toMatchObject({ code: "SEED_REQUIERE_AZURE_SQL_DEV" });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.poolConstructor).not.toHaveBeenCalled();
  });
});
