// Guard exclusivo de las pruebas que crean y borran datos en SQL DEV.
function readSqlTestConfig(environment) {
  const keys = ["SQL_SERVER_FQDN", "SQL_DATABASE_NAME", "SQL_AUTH_MODE"];
  const required = environment.REQUIRE_AZURE_SQL_TESTS;
  const legacyConfigured =
    environment.SQL_SERVER !== undefined || environment.SQL_DATABASE !== undefined;

  if (legacyConfigured) {
    throw new Error("Las pruebas SQL requieren SQL_SERVER_FQDN y SQL_DATABASE_NAME; los nombres anteriores no son válidos.");
  }
  if (required === undefined && keys.every((key) => environment[key] === undefined)) {
    return null;
  }
  if (required !== undefined && required !== "true") {
    throw new Error("REQUIRE_AZURE_SQL_TESTS solo admite true; omitir la variable para el CI sin integración SQL.");
  }

  const server = environment.SQL_SERVER_FQDN?.trim();
  const database = environment.SQL_DATABASE_NAME?.trim();
  if (!server || !database || environment.SQL_AUTH_MODE !== "managed-identity") {
    throw new Error("Las pruebas SQL requieren SQL_SERVER_FQDN, SQL_DATABASE_NAME y SQL_AUTH_MODE=managed-identity.");
  }
  if (database !== "patitas-dev") {
    throw new Error("Las pruebas SQL solo permiten SQL_DATABASE_NAME=patitas-dev.");
  }
  return { server, database };
}

module.exports = { readSqlTestConfig };
