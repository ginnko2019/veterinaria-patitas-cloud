import type {
  ApiError,
  Cita,
  CrearCitaRequest,
  HealthResponse,
  Servicio,
  Veterinario,
} from '../types/api'

// En produccion la API siempre se publica bajo la MISMA URL de Static Web Apps.
// El proxy SWA adjunta la identidad verificada; no enviar tokens inventados.
export const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') || '/api')

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(API_BASE_URL + path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  let payload: unknown = null
  if (isJson) {
    try {
      payload = await response.json() as unknown
    } catch {
      throw new ApiRequestError(response.status, 'RESPUESTA_INVALIDA', 'La API devolvio JSON invalido.')
    }
  }

  if (!response.ok) {
    const maybeError = payload as Partial<ApiError> | null
    throw new ApiRequestError(
      response.status,
      typeof maybeError?.code === 'string' ? maybeError.code : 'HTTP_ERROR',
      typeof maybeError?.message === 'string' ? maybeError.message : 'No se pudo completar la solicitud.',
    )
  }

  if (!isJson) {
    throw new ApiRequestError(response.status, 'RESPUESTA_INVALIDA', 'La API no devolvio JSON.')
  }

  return payload as T
}

export const patitasApi = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/health', { signal }),
  veterinarios: (signal?: AbortSignal) => request<Veterinario[]>('/veterinarios', { signal }),
  servicios: (signal?: AbortSignal) => request<Servicio[]>('/servicios', { signal }),

  // Backend PR #6: acceso solo tras validar la sesion y el acceso DIRECTO denegado.
  // No invocar desde la interfaz de produccion hasta cerrar la revision de seguridad.
  citas: () => request<Cita[]>('/citas'),
  crearCita: (data: CrearCitaRequest) => request<Cita>('/citas', { method: 'POST', body: data }),
  cancelarCita: (id: string) =>
    request<Cita>('/citas/' + encodeURIComponent(id) + '/cancelar', { method: 'PATCH' }),
}
