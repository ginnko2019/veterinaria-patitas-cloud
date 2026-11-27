import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";

export interface ClienteDevInput {
  identityId: string;
  nombreCliente: string;
  mascotaId: string;
  nombreMascota: string;
}

export interface SeedDevConfig {
  server: string;
  database: string;
  environment: string;
  authMode: string;
}

export class SeedClienteDevError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function configuracionSeedDev(
  env: NodeJS.ProcessEnv = process.env
): SeedDevConfig {
  return {
    server: env.SQL_SERVER_FQDN?.trim() ?? "",
    database: env.SQL_DATABASE_NAME?.trim() ?? "",
    environment: env.APP_ENV ?? "",
    authMode: env.SQL_AUTH_MODE ?? "",
  };
}

function validarEntrada(config: SeedDevConfig, input: unknown): ClienteDevInput {
  if (
    config.environment !== "dev" ||
    config.database !== "patitas-dev" ||
    config.authMode !== "managed-identity" ||
    !/^[a-z0-9-]+\.database\.windows\.net$/i.test(config.server)
  ) {
    throw new SeedClienteDevError("SEED_REQUIERE_AZURE_SQL_DEV");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SeedClienteDevError("SEED_DATOS_INVALIDOS");
  }
  const value = input as Record<string, unknown>;
  for (const [key, max] of [
    ["identityId", 128],
    ["nombreCliente", 100],
    ["nombreMascota", 80],
  ] as const) {
    if (
      typeof value[key] !== "string" ||
      !value[key].trim() ||
      value[key].length > max
    ) {
      throw new SeedClienteDevError("SEED_DATOS_INVALIDOS");
    }
  }
  if (
    typeof value.mascotaId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.mascotaId)
  ) {
    throw new SeedClienteDevError("SEED_DATOS_INVALIDOS");
  }
  return {
    identityId: value.identityId as string,
    nombreCliente: (value.nombreCliente as string).trim(),
    mascotaId: value.mascotaId,
    nombreMascota: (value.nombreMascota as string).trim(),
  };
}

// Todos los valores del archivo externo viajan como parametros del driver.
// Las consultas bloquean las claves durante la transaccion para que un rerun
// reutilice el cliente y la mascota, sin reasignar ni renombrar filas existentes.
const CARGAR_CLIENTE_SQL = `
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  SET ANSI_NULLS ON;
  SET ANSI_PADDING ON;
  SET ANSI_WARNINGS ON;
  SET ARITHABORT ON;
  SET CONCAT_NULL_YIELDS_NULL ON;
  SET QUOTED_IDENTIFIER ON;
  SET NUMERIC_ROUNDABORT OFF;

  IF DB_NAME() <> N'patitas-dev'
    THROW 51010, 'SEED_REQUIERE_AZURE_SQL_DEV', 1;

  DECLARE @clienteId UNIQUEIDENTIFIER;
  DECLARE @nombreActual NVARCHAR(100);
  SELECT @clienteId = id, @nombreActual = nombre
  FROM dbo.Clientes WITH (UPDLOCK, HOLDLOCK)
  WHERE identity_id = @identityId;

  IF @clienteId IS NULL
  BEGIN
    SET @clienteId = NEWID();
    INSERT INTO dbo.Clientes (id, identity_id, nombre)
    VALUES (@clienteId, @identityId, @nombreCliente);
  END
  ELSE IF @nombreActual IS NULL OR @nombreActual <> @nombreCliente
    THROW 51011, 'SEED_CLIENTE_EXISTENTE_DIFIERE', 1;

  IF EXISTS (
    SELECT 1 FROM dbo.Mascotas WITH (UPDLOCK, HOLDLOCK)
    WHERE id = @mascotaId
      AND (cliente_id <> @clienteId OR nombre <> @nombreMascota)
  )
    THROW 51012, 'SEED_MASCOTA_EXISTENTE_DIFIERE', 1;

  IF NOT EXISTS (
    SELECT 1 FROM dbo.Mascotas WITH (UPDLOCK, HOLDLOCK)
    WHERE id = @mascotaId
  )
    INSERT INTO dbo.Mascotas (id, cliente_id, nombre)
    VALUES (@mascotaId, @clienteId, @nombreMascota);
`;

export async function cargarClienteDev(
  config: SeedDevConfig,
  rawInput: unknown
): Promise<void> {
  // La validacion ocurre antes de pedir un token o abrir una conexion.
  const input = validarEntrada(config, rawInput);
  const token = await new DefaultAzureCredential().getToken(
    "https://database.windows.net/.default"
  );
  if (!token) throw new SeedClienteDevError("SEED_TOKEN_NO_DISPONIBLE");

  const pool = new sql.ConnectionPool({
    server: config.server,
    database: config.database,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      useUTC: true,
      enableArithAbort: true,
      abortTransactionOnError: true,
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: token.token },
    },
  });
  pool.on("error", () => console.error("SQL_SEED_POOL_ERROR"));
  try {
    await pool.connect();
    const transaction = new sql.Transaction(pool);
    let started = false;
    let rolledBack = false;
    transaction.on("rollback", () => { rolledBack = true; });
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      started = true;
      await transaction.request()
        .input("identityId", sql.NVarChar(128), input.identityId)
        .input("nombreCliente", sql.NVarChar(100), input.nombreCliente)
        .input("mascotaId", sql.UniqueIdentifier, input.mascotaId)
        .input("nombreMascota", sql.NVarChar(80), input.nombreMascota)
        .query(CARGAR_CLIENTE_SQL);
      await transaction.commit();
    } catch (error) {
      if (started && !rolledBack) {
        try { await transaction.rollback(); } catch { /* Conservar el error original. */ }
      }
      throw error;
    }
  } finally {
    await pool.close();
  }
}
