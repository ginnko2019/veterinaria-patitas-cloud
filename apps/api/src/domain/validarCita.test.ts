import { describe, expect, it } from "vitest";
import { NuevaCitaInput } from "./cita";
import { DominioError } from "./errores";
import { validarCita } from "./validarCita";

const ahora = new Date("2026-11-24T12:00:00Z");
const base: NuevaCitaInput = {
  mascotaId: "2c73eae2-d6f2-4f38-aeb8-82cb722f9328",
  veterinarioId: "6baec109-23fc-4715-9154-9ab1a86f436f",
  servicioId: "5b442a3a-8a08-4760-82d9-97e67971c7bf",
  inicioUtc: "2026-12-01T15:00:00Z",
};

function esperarError(input: NuevaCitaInput, code: string): void {
  try {
    validarCita(input, ahora);
    throw new Error("Se esperaba DominioError");
  } catch (error) {
    expect(error).toBeInstanceOf(DominioError);
    expect((error as DominioError).code).toBe(code);
  }
}

describe("validarCita", () => {
  it("rechaza campos obligatorios faltantes", () => {
    esperarError(
      { ...base, mascotaId: "" },
      "CAMPOS_OBLIGATORIOS"
    );
  });

  it("rechaza IDs que no sean UUID", () => {
    esperarError({ ...base, veterinarioId: "no-es-uuid" }, "ID_INVALIDO");
  });

  it("rechaza fechas invalidas", () => {
    esperarError({ ...base, inicioUtc: "2026-12-01" }, "FECHA_INVALIDA");
  });

  it("rechaza fechas en el pasado", () => {
    esperarError(
      { ...base, inicioUtc: "2026-11-24T11:59:59Z" },
      "FECHA_EN_PASADO"
    );
  });

  it("acepta una fecha futura valida", () => {
    expect(() => validarCita(base, ahora)).not.toThrow();
  });

  it("rechaza domingo", () => {
    esperarError(
      { ...base, inicioUtc: "2026-12-06T15:00:00Z" },
      "HORARIO_NO_PERMITIDO"
    );
  });

  it("rechaza antes de las 8:00", () => {
    esperarError(
      { ...base, inicioUtc: "2026-12-01T12:30:00Z" },
      "HORARIO_NO_PERMITIDO"
    );
  });

  it("rechaza a las 18:00", () => {
    esperarError(
      { ...base, inicioUtc: "2026-12-01T23:00:00Z" },
      "HORARIO_NO_PERMITIDO"
    );
  });

  it("rechaza minutos que no sean 00 o 30", () => {
    esperarError(
      { ...base, inicioUtc: "2026-12-01T15:15:00Z" },
      "FRANJA_NO_ALINEADA"
    );
  });

  it("rechaza motivo mayor a 200 caracteres", () => {
    esperarError(
      { ...base, motivo: "a".repeat(201) },
      "CAMPOS_OBLIGATORIOS"
    );
  });
});
