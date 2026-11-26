/**
 * Static Web Apps mantiene la sesion y proporciona datos basicos al cliente.
 * ObtenerSesion no valida identidades: la autorizacion REAL corresponde al proxy
 * de SWA y al backend (ver revision de seguridad PR #6).
 */
export interface ClientPrincipal {
  userId: string
  userDetails?: string
  userRoles: string[]
  identityProvider?: string
}

function esPrincipal(value: unknown): value is ClientPrincipal {
  if (!value || typeof value !== 'object') return false
  const obj = value as Partial<ClientPrincipal>
  return typeof obj.userId === 'string'
    && Array.isArray(obj.userRoles)
    && obj.userRoles.includes('authenticated')
}

export async function obtenerSesion(signal?: AbortSignal): Promise<ClientPrincipal | null> {
  const response = await fetch('/.auth/me', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  })

  if (!response.ok) throw new Error('No se pudo consultar la sesion de Static Web Apps.')

  const data: unknown = await response.json()
  if (!data || typeof data !== 'object') return null
  const principal = (data as { clientPrincipal?: unknown }).clientPrincipal
  return esPrincipal(principal) ? principal : null
}

export const URL_INICIAR_SESION = '/.auth/login/aad'
export const URL_CERRAR_SESION = '/.auth/logout'
