const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  if (process.argv[2] === "--help") {
    console.log("Uso: node scripts/seed-cliente-dev.cjs /ruta/fuera/del/repositorio/cliente-dev.json");
    return;
  }
  if (process.argv.length !== 3) throw new Error("SEED_ARCHIVO_REQUERIDO");

  const inputPath = await fs.realpath(process.argv[2]);
  const repositoryRoot = await fs.realpath(path.resolve(__dirname, "../../.."));
  const relative = path.relative(repositoryRoot, inputPath);
  if (relative === "" || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) {
    throw new Error("SEED_ARCHIVO_DEBE_ESTAR_FUERA_DEL_REPOSITORIO");
  }

  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const { cargarClienteDev, configuracionSeedDev } = require("../dist/src/database/seedClienteDev.js");
  await cargarClienteDev(configuracionSeedDev(), input);
  console.log("Carga de cliente y mascota DEV completada; una repeticion con los mismos datos reutiliza los registros.");
}

main().catch((error) => {
  // No imprimir objetos del driver, tokens, contenido JSON ni valores personales.
  const code = typeof error?.code === "string" && /^SEED_[A-Z_]+$/.test(error.code)
    ? error.code
    : typeof error?.message === "string" && /^SEED_[A-Z_]+$/.test(error.message)
      ? error.message
      : "SEED_CLIENTE_DEV_FALLIDO";
  console.error(code);
  process.exitCode = 1;
});
