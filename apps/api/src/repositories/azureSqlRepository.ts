import { DefaultAzureCredential } from "@azure/identity";
import sql from "mssql";
import { Cita, EstadoCita } from "../domain/cita";
import { DominioError } from "../domain/errores";
import {
  CatalogoRepository,
  CitasRepository,
  Cliente,
  Mascota,
  Servicio,
  Veterinario,
} from "./citasRepository";

const TOKEN_SCOPE = "https://database.windows.net/.default";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// SQL_AUTH_MODE declara el contrato de despliegue; esta cadena también admite
// credenciales de desarrollo (por ejemplo, Azure CLI) y no fuerza una identidad.
const credential = new DefaultAzureCredential();

let connectionPool: sql.ConnectionPool | undefined;
let poolExpiresAt = 0;
let poolPromise: Promise<sql.ConnectionPool> | undefined;
let poolConfigKey: string | undefined;

function esUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

function fechaIso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function mapearCita(row: Record<string, unknown>): Cita {
  return {
    id: String(row.id),
    clienteId: String(row.cliente_id),
    mascotaId: String(row.mascota_id),
    veterinarioId: String(row.veterinario_id),
    servicioId: String(row.servicio_id),
    inicioUtc: fechaIso(row.inicio_utc),
    motivo: row.motivo === null ? undefined : String(row.motivo),
    estado: String(row.estado) as EstadoCita,
  };
}

function mapearMascota(row: Record<string, unknown>): Mascota {
  return {
    id: String(row.id),
    clienteId: String(row.cliente_id),
    nombre: String(row.nombre),
  };
}

function mapearVeterinario(row: Record<string, unknown>): Veterinario {
  return { id: String(row.id), nombre: String(row.nombre) };
}

function mapearServicio(row: Record<string, unknown>): Servicio {
  return {
    id: String(row.id),
    nombre: String(row.nombre),
    duracionMinutos: Number(row.duracion_minutos),
  };
}

function conflictoSql(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "number" in error &&
    (error.number === 2601 || error.number === 2627)
  );
}

export function obtenerConfiguracionSql(): { server: string; database: string } {
  const server = process.env.SQL_SERVER_FQDN?.trim();
  const database = process.env.SQL_DATABASE_NAME?.trim();
  if (!server || !database || process.env.SQL_AUTH_MODE !== "managed-identity") {
    throw Object.assign(new Error("PERSISTENCIA_NO_CONFIGURADA"), {
      code: "PERSISTENCIA_NO_CONFIGURADA",
    });
  }
  return { server, database };
}

async function obtenerPool(): Promise<sql.ConnectionPool> {
  const { server, database } = obtenerConfiguracionSql();

  const configKey = `${server}\u0000${database}`;
  const tokenValido =
    connectionPool &&
    poolConfigKey === configKey &&
    poolExpiresAt > Date.now() + 5 * 60 * 1000;
  if (tokenValido) return connectionPool!;
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    const token = await credential.getToken(TOKEN_SCOPE);
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
    // El pool puede emitir errores fuera de una petición. No registrar detalles
    // del driver, tokens, consultas ni datos del cliente en este listener.
    nuevoPool.on("error", () => console.error("SQL_POOL_ERROR"));
    await nuevoPool.connect();

    const poolAnterior = connectionPool;
    connectionPool = nuevoPool;
    poolConfigKey = configKey;
    poolExpiresAt = token.expiresOnTimestamp;
    if (poolAnterior) await poolAnterior.close();
    return nuevoPool;
  })();

  try {
    return await poolPromise;
  } finally {
    poolPromise = undefined;
  }
}

export class AzureSqlRepository
  implements CitasRepository, CatalogoRepository
{
  async crear(cita: Cita): Promise<Cita> {
    if (
      !esUuid(cita.clienteId) ||
      !esUuid(cita.mascotaId) ||
      !esUuid(cita.veterinarioId) ||
      !esUuid(cita.servicioId)
    ) {
      throw new DominioError("NO_ENCONTRADA", 404);
    }

    try {
      const pool = await obtenerPool();
      const result = await pool
        .request()
        .input("clienteId", sql.UniqueIdentifier, cita.clienteId)
        .input("mascotaId", sql.UniqueIdentifier, cita.mascotaId)
        .input("veterinarioId", sql.UniqueIdentifier, cita.veterinarioId)
        .input("servicioId", sql.UniqueIdentifier, cita.servicioId)
        .input("inicioUtc", sql.DateTime2(0), new Date(cita.inicioUtc))
        .input("motivo", sql.NVarChar(200), cita.motivo ?? null)
        .query(`
          INSERT INTO dbo.Citas
            (cliente_id, mascota_id, veterinario_id, servicio_id, inicio_utc,
             motivo, estado)
          OUTPUT INSERTED.id, INSERTED.cliente_id, INSERTED.mascota_id,
                 INSERTED.veterinario_id, INSERTED.servicio_id,
                 INSERTED.inicio_utc, INSERTED.motivo, INSERTED.estado
          VALUES
            (@clienteId, @mascotaId, @veterinarioId, @servicioId, @inicioUtc,
             @motivo, N'PROGRAMADA');
        `);
      return mapearCita(result.recordset[0]);
    } catch (error) {
      if (conflictoSql(error)) {
        throw new DominioError("CONFLICTO_HORARIO", 409);
      }
      throw error;
    }
  }

  async listarPorCliente(clienteId: string): Promise<Cita[]> {
    if (!esUuid(clienteId)) return [];
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("clienteId", sql.UniqueIdentifier, clienteId)
      .query(`
        SELECT id, cliente_id, mascota_id, veterinario_id, servicio_id,
               inicio_utc, motivo, estado
        FROM dbo.Citas
        WHERE cliente_id = @clienteId;
      `);
    return result.recordset.map(mapearCita);
  }

  async listarTodas(): Promise<Cita[]> {
    const pool = await obtenerPool();
    const result = await pool.request().query(`
      SELECT id, cliente_id, mascota_id, veterinario_id, servicio_id,
             inicio_utc, motivo, estado
      FROM dbo.Citas;
    `);
    return result.recordset.map(mapearCita);
  }

  async obtenerPorId(id: string): Promise<Cita | undefined> {
    if (!esUuid(id)) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`
        SELECT id, cliente_id, mascota_id, veterinario_id, servicio_id,
               inicio_utc, motivo, estado
        FROM dbo.Citas
        WHERE id = @id;
      `);
    return result.recordset[0] ? mapearCita(result.recordset[0]) : undefined;
  }

  async cancelar(id: string): Promise<Cita | undefined> {
    if (!esUuid(id)) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`
        UPDATE dbo.Citas
        SET estado = N'CANCELADA',
            cancelada_utc = COALESCE(cancelada_utc, SYSUTCDATETIME())
        OUTPUT INSERTED.id, INSERTED.cliente_id, INSERTED.mascota_id,
               INSERTED.veterinario_id, INSERTED.servicio_id,
               INSERTED.inicio_utc, INSERTED.motivo, INSERTED.estado
        WHERE id = @id;
      `);
    return result.recordset[0] ? mapearCita(result.recordset[0]) : undefined;
  }

  async listarVeterinarios(): Promise<Veterinario[]> {
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .query("SELECT id, nombre FROM dbo.Veterinarios;");
    return result.recordset.map(mapearVeterinario);
  }

  async listarServicios(): Promise<Servicio[]> {
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .query(
        "SELECT id, nombre, duracion_minutos FROM dbo.Servicios;"
      );
    return result.recordset.map(mapearServicio);
  }

  async listarMascotasPorCliente(clienteId: string): Promise<Mascota[]> {
    if (!esUuid(clienteId)) return [];
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("clienteId", sql.UniqueIdentifier, clienteId)
      .query(`
        SELECT id, cliente_id, nombre
        FROM dbo.Mascotas
        WHERE cliente_id = @clienteId;
      `);
    return result.recordset.map(mapearMascota);
  }

  async obtenerMascota(id: string): Promise<Mascota | undefined> {
    if (!esUuid(id)) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`
        SELECT id, cliente_id, nombre
        FROM dbo.Mascotas
        WHERE id = @id;
      `);
    return result.recordset[0] ? mapearMascota(result.recordset[0]) : undefined;
  }

  async obtenerVeterinario(id: string): Promise<Veterinario | undefined> {
    if (!esUuid(id)) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query("SELECT id, nombre FROM dbo.Veterinarios WHERE id = @id;");
    return result.recordset[0]
      ? mapearVeterinario(result.recordset[0])
      : undefined;
  }

  async obtenerServicio(id: string): Promise<Servicio | undefined> {
    if (!esUuid(id)) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(`
        SELECT id, nombre, duracion_minutos
        FROM dbo.Servicios
        WHERE id = @id;
      `);
    return result.recordset[0] ? mapearServicio(result.recordset[0]) : undefined;
  }

  async obtenerClientePorIdentidad(
    identityId: string
  ): Promise<Cliente | undefined> {
    if (identityId.length === 0 || identityId.length > 128) return undefined;
    const pool = await obtenerPool();
    const result = await pool
      .request()
      .input("identityId", sql.NVarChar(128), identityId)
      .query(`
        SELECT id, identity_id
        FROM dbo.Clientes
        WHERE identity_id = @identityId;
      `);
    const row = result.recordset[0];
    return row
      ? { id: String(row.id), identityId: String(row.identity_id) }
      : undefined;
  }
}
