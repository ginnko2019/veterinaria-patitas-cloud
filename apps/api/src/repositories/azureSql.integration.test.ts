import { randomUUID } from "crypto";
import { HttpRequest, InvocationContext } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCitas, patchCancelarCita, postCita } from "../functions/citas";
import { obtenerConfiguracionSql } from "./azureSqlRepository";

// Sin configuración SQL, el CI común omite esta prueba. Una configuración
// parcial o desconocida sí la activa y falla antes de contactar a Azure.
const habilitada = [
  "SQL_SERVER_FQDN",
  "SQL_DATABASE_NAME",
  "SQL_AUTH_MODE",
].some((key) => process.env[key] !== undefined);
const describeSql = describe.skipIf(!habilitada);
const credential = new DefaultAzureCredential();
const identityA = `integration-a-${randomUUID()}`;
const identityB = `integration-b-${randomUUID()}`;
const clienteA = randomUUID();
const clienteB = randomUUID();
const mascotaA = randomUUID();
const mascotaB = randomUUID();
const veterinario = randomUUID();
const servicio = randomUUID();
const slot = "2030-12-03T15:00:00.000Z";
let pool: sql.ConnectionPool;
let citaCreadaId: string;
const envOriginal: Record<string, string | undefined> = {};

function request(
  identityId: string,
  body?: unknown,
  citaId?: string
): HttpRequest {
  const principal = Buffer.from(
    JSON.stringify({ userId: identityId, userRoles: ["authenticated"] }),
    "utf8"
  ).toString("base64");
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "x-ms-client-principal" ? principal : null,
    },
    params: citaId ? { id: citaId } : {},
    query: new URLSearchParams(),
    json: async () => body,
  } as unknown as HttpRequest;
}

const context = { error: () => undefined } as unknown as InvocationContext;
const baseInput = {
  mascotaId: mascotaA,
  veterinarioId: veterinario,
  servicioId: servicio,
  inicioUtc: slot,
};

describeSql("Azure SQL integration (DEV)", () => {
  beforeAll(async () => {
    const { server, database } = obtenerConfiguracionSql();
    for (const key of [
      "PERSISTENCE",
      "TRUST_SWA_PRINCIPAL",
    ]) {
      envOriginal[key] = process.env[key];
    }
    process.env.PERSISTENCE = "sql";
    process.env.TRUST_SWA_PRINCIPAL = "true";

    const token = await credential.getToken(
      "https://database.windows.net/.default"
    );
    if (!token) throw new Error("No se pudo obtener el token de Azure SQL.");
    const nuevoPool = new sql.ConnectionPool({
      server,
      database,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        useUTC: true,
      },
      authentication: {
        type: "azure-active-directory-access-token",
        options: { token: token.token },
      },
    });
    nuevoPool.on("error", () => console.error("SQL_TEST_POOL_ERROR"));
    pool = await nuevoPool.connect();

    await pool
      .request()
      .input("clienteA", sql.UniqueIdentifier, clienteA)
      .input("clienteB", sql.UniqueIdentifier, clienteB)
      .input("identityA", sql.NVarChar(128), identityA)
      .input("identityB", sql.NVarChar(128), identityB)
      .input("mascotaA", sql.UniqueIdentifier, mascotaA)
      .input("mascotaB", sql.UniqueIdentifier, mascotaB)
      .input("veterinario", sql.UniqueIdentifier, veterinario)
      .input("servicio", sql.UniqueIdentifier, servicio)
      .query(`
        INSERT INTO dbo.Clientes (id, identity_id, nombre)
        VALUES (@clienteA, @identityA, N'Cliente de integracion A'),
               (@clienteB, @identityB, N'Cliente de integracion B');
        INSERT INTO dbo.Mascotas (id, cliente_id, nombre)
        VALUES (@mascotaA, @clienteA, N'Mascota de integracion A'),
               (@mascotaB, @clienteB, N'Mascota de integracion B');
        INSERT INTO dbo.Veterinarios (id, nombre)
        VALUES (@veterinario, N'Veterinario de integracion');
        INSERT INTO dbo.Servicios (id, nombre, duracion_minutos)
        VALUES (@servicio, N'Servicio de integracion', 30);
      `);
  }, 30_000);

  afterAll(async () => {
    if (pool) {
      await pool
        .request()
        .input("clienteA", sql.UniqueIdentifier, clienteA)
        .input("clienteB", sql.UniqueIdentifier, clienteB)
        .input("mascotaA", sql.UniqueIdentifier, mascotaA)
        .input("mascotaB", sql.UniqueIdentifier, mascotaB)
        .input("veterinario", sql.UniqueIdentifier, veterinario)
        .input("servicio", sql.UniqueIdentifier, servicio)
        .query(`
          DELETE FROM dbo.Citas
          WHERE cliente_id IN (@clienteA, @clienteB);
          DELETE FROM dbo.Mascotas
          WHERE id IN (@mascotaA, @mascotaB);
          DELETE FROM dbo.Clientes
          WHERE id IN (@clienteA, @clienteB);
          DELETE FROM dbo.Veterinarios WHERE id = @veterinario;
          DELETE FROM dbo.Servicios WHERE id = @servicio;
        `);
      await pool.close();
    }
    for (const [key, value] of Object.entries(envOriginal)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 30_000);

  it("arbitra reservas concurrentes, libera la franja y aísla clientes", async () => {
    const concurrentes = await Promise.all([
      postCita(request(identityA, baseInput), context),
      postCita(request(identityA, baseInput), context),
    ]);
    expect(concurrentes.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const creada = concurrentes.find((response) => response.status === 201)!;
    citaCreadaId = (creada.jsonBody as { id: string }).id;

    const cancelada = await patchCancelarCita(
      request(identityA, undefined, citaCreadaId),
      context
    );
    expect(cancelada.status).toBe(200);
    expect(cancelada.jsonBody).toMatchObject({ estado: "CANCELADA" });

    const liberada = await postCita(request(identityA, baseInput), context);
    expect(liberada.status).toBe(201);

    const citasA = await getCitas(request(identityA), context);
    const citasB = await getCitas(request(identityB), context);
    expect(citasA.status).toBe(200);
    expect(citasA.jsonBody).toHaveLength(2);
    expect(citasB.status).toBe(200);
    expect(citasB.jsonBody).toEqual([]);
  }, 30_000);
});
