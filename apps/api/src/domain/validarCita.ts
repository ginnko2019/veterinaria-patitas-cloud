import {
  DIAS_ATENCION,
  HORA_FIN,
  HORA_INICIO,
  OFFSET_BOGOTA_HORAS,
} from "./config";
import { DominioError } from "./errores";
import { NuevaCitaInput } from "./cita";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_CON_ZONA_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/i;

export function validarCita(
  input: NuevaCitaInput,
  ahora: Date = new Date()
): void {
  if (
    !input ||
    !input.mascotaId ||
    !input.veterinarioId ||
    !input.servicioId ||
    !input.inicioUtc
  ) {
    throw new DominioError("CAMPOS_OBLIGATORIOS", 400);
  }

  if (
    !UUID_REGEX.test(input.mascotaId) ||
    !UUID_REGEX.test(input.veterinarioId) ||
    !UUID_REGEX.test(input.servicioId)
  ) {
    throw new DominioError("ID_INVALIDO", 400);
  }

  if (
    typeof input.inicioUtc !== "string" ||
    !ISO_CON_ZONA_REGEX.test(input.inicioUtc)
  ) {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  const fecha = new Date(input.inicioUtc);
  if (Number.isNaN(fecha.getTime())) {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  if (fecha.getTime() <= ahora.getTime()) {
    throw new DominioError("FECHA_EN_PASADO", 422);
  }

  const bogotaMs =
    fecha.getTime() + OFFSET_BOGOTA_HORAS * 60 * 60 * 1000;
  const bogota = new Date(bogotaMs);
  const diaUtc = bogota.getUTCDay();

  if (!DIAS_ATENCION.includes(diaUtc as (typeof DIAS_ATENCION)[number])) {
    throw new DominioError("HORARIO_NO_PERMITIDO", 422);
  }

  const hora = bogota.getUTCHours();
  const minutos = bogota.getUTCMinutes();
  const segundos = bogota.getUTCSeconds();

  if (hora < HORA_INICIO || hora >= HORA_FIN) {
    throw new DominioError("HORARIO_NO_PERMITIDO", 422);
  }

  if (minutos !== 0 && minutos !== 30) {
    throw new DominioError("FRANJA_NO_ALINEADA", 422);
  }

  if (segundos !== 0 || bogota.getUTCMilliseconds() !== 0) {
    throw new DominioError("FRANJA_NO_ALINEADA", 422);
  }

  if (input.motivo !== undefined && input.motivo.length > 200) {
    throw new DominioError("CAMPOS_OBLIGATORIOS", 400);
  }
}
