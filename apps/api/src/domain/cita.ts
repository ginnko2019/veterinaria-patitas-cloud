export interface NuevaCitaInput {
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  /** Opcional en el dominio; el frontend puede exigirlo. */
  motivo?: string;
}

export type EstadoCita = "PROGRAMADA" | "CANCELADA";

export interface Cita {
  id: string;
  clienteId: string;
  mascotaId: string;
  veterinarioId: string;
  servicioId: string;
  inicioUtc: string;
  motivo?: string;
  estado: EstadoCita;
}
