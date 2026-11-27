export interface AzureTargets {
  directApi: URL;
  swaApi: URL;
}

export interface DirectProbe {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  forgedPrincipal: boolean;
  body?: Record<string, unknown>;
}

type FetchProbe = (url: URL, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10000;
export const PROBE_TEST_TIMEOUT_MS = 15000;

const FORGED_PRINCIPAL = Buffer.from(
  JSON.stringify({
    userId: "usuario-inventado",
    userRoles: ["anonymous", "authenticated", "ADMIN"],
  }),
  "utf8"
).toString("base64");

// Agregar aqui las rutas nuevas: la suite ejecuta una prueba por sonda.
export const DIRECT_PROBES: readonly DirectProbe[] = [
  { name: "health sin identidad", method: "GET", path: "health", forgedPrincipal: false },
  { name: "health con ADMIN falsificado", method: "GET", path: "health", forgedPrincipal: true },
  { name: "catalogo de veterinarios", method: "GET", path: "veterinarios", forgedPrincipal: true },
  { name: "catalogo de servicios", method: "GET", path: "servicios", forgedPrincipal: true },
  { name: "consulta de mascotas", method: "GET", path: "mascotas?clienteId=usuario-inventado", forgedPrincipal: true },
  { name: "consulta de citas", method: "GET", path: "citas", forgedPrincipal: true },
  {
    name: "creacion de citas", method: "POST", path: "citas", forgedPrincipal: true,
    body: {
      mascotaId: "f0000000-0000-4000-8000-000000000001",
      veterinarioId: "f0000000-0000-4000-8000-000000000002",
      servicioId: "f0000000-0000-4000-8000-000000000003",
      inicioUtc: "2031-12-03T15:00:00Z",
    },
  },
  {
    name: "cancelacion de citas", method: "PATCH",
    path: "citas/f0000000-0000-4000-8000-000000000004/cancelar", forgedPrincipal: true,
  },
];

function parseApiBase(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${name} debe ser una URL HTTPS absoluta terminada en /api.`);
  }
  if (
    url.protocol !== "https:" || !url.hostname ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/api" && url.pathname !== "/api/")
  ) {
    throw new Error(`${name} debe usar HTTPS y /api, sin credenciales, consulta ni fragmento.`);
  }
  url.pathname = "/api/";
  return url;
}

export function readAzureTargets(environment: Record<string, string | undefined>): AzureTargets | null {
  const direct = environment.FUNCTION_DIRECT_URL;
  const swa = environment.SWA_API_URL;
  const required = environment.REQUIRE_AZURE_SECURITY_TESTS === "true";
  // Solo la ausencia completa permite omitir integracion en la CI de codigo.
  if (direct === undefined && swa === undefined && !required) return null;
  if (!direct?.trim() || !swa?.trim()) {
    throw new Error("Las pruebas de Azure requieren FUNCTION_DIRECT_URL y SWA_API_URL, ambas con /api.");
  }
  const targets = {
    directApi: parseApiBase(direct, "FUNCTION_DIRECT_URL"),
    swaApi: parseApiBase(swa, "SWA_API_URL"),
  };
  if (targets.directApi.origin === targets.swaApi.origin) {
    throw new Error("FUNCTION_DIRECT_URL y SWA_API_URL deben identificar origenes distintos.");
  }
  return targets;
}

async function sendProbe(apiBase: URL, probe: DirectProbe, fetchProbe: FetchProbe): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (probe.forgedPrincipal) headers["x-ms-client-principal"] = FORGED_PRINCIPAL;
  if (probe.body) headers["Content-Type"] = "application/json";
  // Un fallo de red/timeout se propaga: no prueba una denegacion de Azure.
  return fetchProbe(new URL(probe.path, apiBase), {
    method: probe.method, headers,
    body: probe.body ? JSON.stringify(probe.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function verifySwaHealth(swaApi: URL, fetchProbe: FetchProbe = fetch): Promise<void> {
  const response = await sendProbe(swaApi, {
    name: "health por SWA", method: "GET", path: "health", forgedPrincipal: false,
  }, fetchProbe);
  if (response.status !== 200) {
    throw new Error(`Health por SWA debe responder 200; recibio ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    (body as Record<string, unknown>).status !== "ok" ||
    (body as Record<string, unknown>).service !== "patitas-api"
  ) {
    throw new Error("Health por SWA no corresponde al contrato de patitas-api.");
  }
}

export async function verifyDirectDenial(
  directApi: URL, probe: DirectProbe, fetchProbe: FetchProbe = fetch
): Promise<void> {
  const response = await sendProbe(directApi, probe, fetchProbe);
  if (response.status !== 401 && response.status !== 403) {
    throw new Error(`${probe.name}: acceso directo debe responder 401/403; recibio ${response.status}.`);
  }
  const content = await response.text();
  if (/"(clienteId|mascotaId|veterinarioId|servicioId|inicioUtc|estado)"\s*:/.test(content)) {
    throw new Error(`${probe.name}: la denegacion directa contiene datos de negocio.`);
  }
}
