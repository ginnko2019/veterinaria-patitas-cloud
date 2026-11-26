/**
 * Tipos compatibles con el dominio del backend de Nicolás (PR #4)
 * y con las respuestas publicas previstas de los handlers HTTP (PR #6).
 */
export type EstadoCita = 'PROGRAMADA' | 'CANCELADA'

export interface Veterinario {
  id: string
  nombre: string
}

export interface Servicio {
  id: string
  nombre: string
  duracionMinutos: number
}

export interface CrearCitaRequest {
  mascotaId: string
  veterinarioId: string
  servicioId: string
  inicioUtc: string
  motivo?: string
}

// El backend excluye clienteId de las respuestas publicas de citas.
export interface Cita extends CrearCitaRequest {
  id: string
  estado: EstadoCita
}

export interface ApiError {
  code: string
  message: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: string
}
