// El gate de Azure exige configuracion real; nunca termina bien por omitirla.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [
    path.join(apiRoot, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "src/security/accesoDirecto.integration.test.ts",
  ],
  {
    cwd: apiRoot,
    stdio: "inherit",
    env: { ...process.env, REQUIRE_AZURE_SECURITY_TESTS: "true" },
  }
);

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
