/**
 * Tipos compartidos con docs/api/contrato-citas.md (propuesta v0.1).
 * Nicolás debe confirmar nombres y respuestas antes de activar reservas reales.
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
  motivo: string
}

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
