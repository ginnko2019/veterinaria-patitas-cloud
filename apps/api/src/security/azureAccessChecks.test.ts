import { describe, expect, it, vi } from "vitest";
import {
  DIRECT_PROBES,
  readAzureTargets,
  verifyDirectDenial,
  verifySwaHealth,
} from "./azureAccessChecks";

const configured = {
  FUNCTION_DIRECT_URL: "https://patitas-function.example/api",
  SWA_API_URL: "https://patitas-web.example/api/",
};
const targets = readAzureTargets(configured)!;
const health = { status: "ok", service: "patitas-api" };
const forgedHealth = DIRECT_PROBES.find((probe) => probe.path === "health" && probe.forgedPrincipal)!;

function response(status: number, body: unknown = { code: "NO_AUTENTICADO" }): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

describe("configuracion de pruebas Azure", () => {
  it("omite solamente cuando ambas URLs estan ausentes y no es el comando estricto", () => {
    expect(readAzureTargets({})).toBeNull();
    expect(() => readAzureTargets({ REQUIRE_AZURE_SECURITY_TESTS: "true" })).toThrow(/requieren/);
  });

  it.each([
    { FUNCTION_DIRECT_URL: configured.FUNCTION_DIRECT_URL },
    { SWA_API_URL: configured.SWA_API_URL },
    { FUNCTION_DIRECT_URL: "", SWA_API_URL: "" },
    { ...configured, SWA_API_URL: " " },
  ])("rechaza configuracion parcial o vacia: %j", (environment) => {
    expect(() => readAzureTargets(environment)).toThrow(/requieren/);
  });

  it.each([
    "not-a-url",
    "http://patitas-function.example/api",
    "https://patitas-function.example",
    "https://patitas-function.example/api/citas",
    "https://patitas-function.example/api?code=ejemplo",
    "https://patitas-function.example/api#fragmento",
    "https://usuario:ejemplo@patitas-function.example/api",
  ])("rechaza una base directa invalida: %s", (url) => {
    expect(() => readAzureTargets({ ...configured, FUNCTION_DIRECT_URL: url })).toThrow(/FUNCTION_DIRECT_URL/);
  });

  it("valida tambien la base SWA y no admite el mismo origen para ambos", () => {
    expect(() => readAzureTargets({ ...configured, SWA_API_URL: "not-a-url" })).toThrow(/SWA_API_URL/);
    expect(() => readAzureTargets({ ...configured, SWA_API_URL: configured.FUNCTION_DIRECT_URL })).toThrow(/distintos/);
  });

  it("normaliza /api con o sin barra final para conservar las rutas", () => {
    expect(targets.directApi.href).toBe("https://patitas-function.example/api/");
    expect(targets.swaApi.href).toBe("https://patitas-web.example/api/");
  });
});

describe("evidencia de acceso Azure", () => {
  it("acepta solamente el health correcto a traves de SWA", async () => {
    const fetchProbe = vi.fn(async (_url: URL, _options: RequestInit) => response(200, health));
    await expect(verifySwaHealth(targets.swaApi, fetchProbe)).resolves.toBeUndefined();
    const [url, options] = fetchProbe.mock.calls[0];
    expect(String(url)).toBe("https://patitas-web.example/api/health");
    expect(options.redirect).toBe("manual");
    expect(options.headers).not.toHaveProperty("x-ms-client-principal");
  });

  it.each([
    { body: { status: "ok", service: "otra-api" } },
    { body: { status: "ok", service: "patitas-api", extra: true } },
    { body: { status: "ok" } },
    { body: [health] },
  ])("rechaza health de otro servicio o contrato: %j", async ({ body }) => {
    await expect(verifySwaHealth(targets.swaApi, async () => response(200, body))).rejects.toThrow(/contrato/);
  });

  it.each([302, 401, 403, 404, 500])("rechaza health SWA con HTTP %s", async (status) => {
    await expect(verifySwaHealth(targets.swaApi, async () => response(status))).rejects.toThrow(/debe responder 200/);
  });

  it.each([200, 302, 404, 500])("un HTTP %s directo no demuestra denegacion", async (status) => {
    await expect(verifyDirectDenial(targets.directApi, forgedHealth, async () => response(status))).rejects.toThrow(/401\/403/);
  });

  it.each([401, 403])("acepta denegacion explicita HTTP %s sin seguir redirecciones", async (status) => {
    const fetchProbe = vi.fn(async (_url: URL, _options: RequestInit) => response(status));
    await expect(verifyDirectDenial(targets.directApi, forgedHealth, fetchProbe)).resolves.toBeUndefined();
    const [url, options] = fetchProbe.mock.calls[0];
    expect(String(url)).toBe("https://patitas-function.example/api/health");
    expect(options.redirect).toBe("manual");
    const principal = JSON.parse(Buffer.from(
      (options.headers as Record<string, string>)["x-ms-client-principal"], "base64"
    ).toString("utf8"));
    expect(principal.userRoles).toContain("ADMIN");
  });

  it.each([
    new TypeError("fetch failed"),
    Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
  ])("propaga el fallo de transporte en ambas direcciones: %s", async (error) => {
    const fetchProbe = vi.fn(async () => { throw error; });
    await expect(verifyDirectDenial(targets.directApi, forgedHealth, fetchProbe)).rejects.toBe(error);
    await expect(verifySwaHealth(targets.swaApi, fetchProbe)).rejects.toBe(error);
  });

  it("detecta la Function abierta aunque el flag haga que las citas respondan 401", async () => {
    const fetchProbe = vi.fn(async (url: URL) =>
      url.pathname === "/api/health" ? response(200, health) : response(401)
    );
    await expect(verifySwaHealth(targets.swaApi, fetchProbe)).resolves.toBeUndefined();
    const citas = DIRECT_PROBES.find((probe) => probe.name === "consulta de citas")!;
    await expect(verifyDirectDenial(targets.directApi, citas, fetchProbe)).resolves.toBeUndefined();
    await expect(verifyDirectDenial(targets.directApi, forgedHealth, fetchProbe)).rejects.toThrow(/recibio 200/);
  });

  it("rechaza una denegacion que incluya datos de negocio", async () => {
    await expect(verifyDirectDenial(targets.directApi, forgedHealth,
      async () => response(403, { clienteId: "cliente-ajeno" })
    )).rejects.toThrow(/datos de negocio/);
  });
});
