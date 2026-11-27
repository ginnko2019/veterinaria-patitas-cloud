import { describe, expect, it } from "vitest";
import {
  DIRECT_PROBES,
  PROBE_TEST_TIMEOUT_MS,
  readAzureTargets,
  verifyDirectDenial,
  verifySwaHealth,
} from "./azureAccessChecks";

// La configuracion parcial/invalida falla al cargar la suite. El comando
// test:seguridad:azure tambien exige configuracion cuando faltan ambas URLs.
const targets = readAzureTargets(process.env);

if (!targets) {
  console.info("Integracion Azure omitida: no se configuraron FUNCTION_DIRECT_URL ni SWA_API_URL.");
}

describe.skipIf(!targets)("frontera de autenticacion SWA / Functions", () => {
  it("SWA alcanza health de Patitas con el contrato exacto", async () => {
    await expect(verifySwaHealth(targets!.swaApi)).resolves.toBeUndefined();
  }, PROBE_TEST_TIMEOUT_MS);

  it.each(DIRECT_PROBES)("rechaza acceso directo: $name", async (probe) => {
    await expect(verifyDirectDenial(targets!.directApi, probe)).resolves.toBeUndefined();
  }, PROBE_TEST_TIMEOUT_MS);
});
