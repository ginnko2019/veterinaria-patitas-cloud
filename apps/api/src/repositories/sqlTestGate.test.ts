import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSqlTestConfig } from "../../scripts/sql-test-config.cjs";
import { runSqlAzureTests } from "../../scripts/test-sql-azure.cjs";

const validEnvironment = {
  SQL_SERVER_FQDN: "test-dev.database.windows.net",
  SQL_DATABASE_NAME: "patitas-dev",
  SQL_AUTH_MODE: "managed-identity",
};
const apiRoot = path.resolve(__dirname, "../..");

describe("guard de integración SQL DEV", () => {
  it("permite omitir solo cuando toda la configuración y el flag están ausentes", () => {
    expect(readSqlTestConfig({})).toBeNull();
    expect(readSqlTestConfig({ NODE_ENV: "test" })).toBeNull();
  });

  it("acepta el contrato completo de DEV y normaliza espacios exteriores", () => {
    expect(readSqlTestConfig({
      ...validEnvironment,
      SQL_SERVER_FQDN: ` ${validEnvironment.SQL_SERVER_FQDN} `,
      SQL_DATABASE_NAME: " patitas-dev ",
      REQUIRE_AZURE_SQL_TESTS: "true",
    })).toEqual({ server: validEnvironment.SQL_SERVER_FQDN, database: "patitas-dev" });
  });

  it.each([
    { SQL_SERVER_FQDN: validEnvironment.SQL_SERVER_FQDN },
    { SQL_DATABASE_NAME: "patitas-dev" },
    { SQL_AUTH_MODE: "managed-identity" },
    { REQUIRE_AZURE_SQL_TESTS: "true" },
    { ...validEnvironment, SQL_SERVER_FQDN: "  " },
    { ...validEnvironment, SQL_DATABASE_NAME: "" },
    { ...validEnvironment, SQL_AUTH_MODE: undefined },
    { ...validEnvironment, SQL_AUTH_MODE: "password" },
  ])("rechaza configuración parcial o desconocida: %j", (environment) => {
    expect(() => readSqlTestConfig(environment)).toThrow("Las pruebas SQL requieren");
  });

  it.each(["", "false", "1"])("no permite omitir con flag definido como %j", (flag) => {
    expect(() => readSqlTestConfig({ REQUIRE_AZURE_SQL_TESTS: flag }))
      .toThrow("REQUIRE_AZURE_SQL_TESTS solo admite true");
  });

  it.each(["patitas-prod", "otra-base", "patitas-dev-copy"])(
    "impide crear o borrar datos de pruebas en %s",
    (database) => {
      expect(() => readSqlTestConfig({ ...validEnvironment, SQL_DATABASE_NAME: database }))
        .toThrow("solo permiten SQL_DATABASE_NAME=patitas-dev");
    }
  );

  it.each(["SQL_SERVER", "SQL_DATABASE"])("no omite ante el nombre anterior %s", (key) => {
    expect(() => readSqlTestConfig({ [key]: "legacy-value" }))
      .toThrow("los nombres anteriores no son válidos");
  });
});

describe("launcher estricto de SQL", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    {},
    { SQL_SERVER_FQDN: validEnvironment.SQL_SERVER_FQDN },
    { ...validEnvironment, SQL_DATABASE_NAME: "patitas-prod" },
    { ...validEnvironment, SQL_AUTH_MODE: "password" },
  ])("rechaza el entorno antes de iniciar Vitest: %j", (environment) => {
    const spawn = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(runSqlAzureTests(environment, spawn)).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fuerza el flag y ejecuta únicamente el archivo de integración SQL", () => {
    const spawn = vi.fn().mockReturnValue({ status: 0 });

    expect(runSqlAzureTests({
      ...validEnvironment,
      REQUIRE_AZURE_SQL_TESTS: "false",
    }, spawn)).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [path.join(apiRoot, "node_modules", "vitest", "vitest.mjs"), "run",
        "src/repositories/azureSql.integration.test.ts"],
      {
        cwd: apiRoot,
        stdio: "inherit",
        env: { ...validEnvironment, REQUIRE_AZURE_SQL_TESTS: "true" },
      }
    );
  });

  it.each([1, 7, null])("propaga el fallo del proceso hijo con status %s", (status) => {
    const spawn = vi.fn().mockReturnValue({ status });
    expect(runSqlAzureTests(validEnvironment, spawn)).toBe(status ?? 1);
  });

  it("falla si no se pudo iniciar el proceso hijo", () => {
    const spawn = vi.fn().mockReturnValue({ error: new Error("spawn falló"), status: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runSqlAzureTests(validEnvironment, spawn)).toBe(1);
  });

  it("el ejecutable real sale con error sin configuración, aunque se le pase --passWithNoTests", () => {
    const environment = { ...process.env };
    for (const key of [
      "SQL_SERVER_FQDN", "SQL_DATABASE_NAME", "SQL_AUTH_MODE",
      "SQL_SERVER", "SQL_DATABASE", "REQUIRE_AZURE_SQL_TESTS",
    ]) delete environment[key];
    const result = spawnSync(process.execPath, [
      path.join(apiRoot, "scripts", "test-sql-azure.cjs"), "--passWithNoTests",
    ], { cwd: apiRoot, env: environment, encoding: "utf8", timeout: 5_000 });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Las pruebas SQL requieren");
    expect(result.stdout).not.toContain("skipped");
  });
});
