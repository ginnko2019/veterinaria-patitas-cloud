import { DominioError } from "./errores";

const ISO_CON_ZONA_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/i;

export function canonicalizarInicioUtc(inicioUtc: string): string {
  if (typeof inicioUtc !== "string") {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  const partes = ISO_CON_ZONA_REGEX.exec(inicioUtc);
  if (!partes) {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  const [, anio, mes, dia, hora, minuto, segundo, fraccion = ""] = partes;
  const fechaLocal = new Date(0);
  fechaLocal.setUTCFullYear(Number(anio), Number(mes) - 1, Number(dia));
  fechaLocal.setUTCHours(
    Number(hora),
    Number(minuto),
    Number(segundo),
    Number((fraccion + "00").slice(0, 3))
  );

  if (
    fechaLocal.getUTCFullYear() !== Number(anio) ||
    fechaLocal.getUTCMonth() !== Number(mes) - 1 ||
    fechaLocal.getUTCDate() !== Number(dia) ||
    fechaLocal.getUTCHours() !== Number(hora) ||
    fechaLocal.getUTCMinutes() !== Number(minuto) ||
    Number(segundo) !== 0 ||
    Number(fraccion || "0") !== 0
  ) {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  const fecha = new Date(inicioUtc);
  if (Number.isNaN(fecha.getTime())) {
    throw new DominioError("FECHA_INVALIDA", 400);
  }

  return fecha.toISOString();
}
