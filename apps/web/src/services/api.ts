import type {
  ApiError,
  Cita,
  CrearCitaRequest,
  HealthResponse,
  Servicio,
  Veterinario,
} from '../types/api'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') ?? ''

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
  accessToken?: string
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiRequestError(0, 'API_NO_CONFIGURADA', 'Configura VITE_API_BASE_URL para conectar la API.')
  }

  const headers: Record<string, string> = { Accept: 'application/json' }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (options.accessToken) {
    headers.Authorization = 'Bearer ' + options.accessToken
  }

  const response = await fetch(API_BASE_URL + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  let payload: unknown = null

  if (isJson) {
    try {
      payload = await response.json() as unknown
    } catch {
      throw new ApiRequestError(response.status, 'RESPUESTA_INVALIDA', 'La API devolvió JSON inválido.')
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

  return payload as T
}

function requireToken(accessToken: string): string {
  if (!accessToken.trim()) {
    throw new ApiRequestError(401, 'AUTENTICACION_REQUERIDA', 'Debes iniciar sesión para gestionar citas.')
  }
  return accessToken
}

export const patitasApi = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/health', { signal }),
  veterinarios: (signal?: AbortSignal) => request<Veterinario[]>('/veterinarios', { signal }),
  servicios: (signal?: AbortSignal) => request<Servicio[]>('/servicios', { signal }),

  // Las operaciones de citas se habilitarán en UI cuando haya autenticación real.
  citas: (token: string) => request<Cita[]>('/citas', { accessToken: requireToken(token) }),
  crearCita: (token: string, data: CrearCitaRequest) =>
    request<Cita>('/citas', { method: 'POST', body: data, accessToken: requireToken(token) }),
  cancelarCita: (token: string, id: string) =>
    request<Cita>('/citas/' + encodeURIComponent(id) + '/cancelar', {
      method: 'PATCH',
      accessToken: requireToken(token),
    }),
}
