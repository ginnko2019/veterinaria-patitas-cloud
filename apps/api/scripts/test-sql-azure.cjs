const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { readSqlTestConfig } = require("./sql-test-config.cjs");

function runSqlAzureTests(environment = process.env, spawn = spawnSync) {
  const strictEnvironment = { ...environment, REQUIRE_AZURE_SQL_TESTS: "true" };
  try {
    readSqlTestConfig(strictEnvironment);
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const apiRoot = path.resolve(__dirname, "..");
  const result = spawn(
    process.execPath,
    [
      path.join(apiRoot, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "src/repositories/azureSql.integration.test.ts",
    ],
    {
      cwd: apiRoot,
      stdio: "inherit",
      env: strictEnvironment,
    }
  );
  if (result.error) {
    console.error("No se pudo iniciar la prueba de integración SQL.");
    return 1;
  }
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = runSqlAzureTests();

module.exports = { runSqlAzureTests };
