import { CitasService } from "./services/citasService";
import {
  MemoriaCatalogoRepository,
  MemoriaCitasRepository,
} from "./repositories/memoriaRepository";

interface RepositoriosMemoria {
  citas: MemoriaCitasRepository;
  catalogo: MemoriaCatalogoRepository;
}

let repositoriosMemoria: RepositoriosMemoria | undefined;
let citasService: CitasService | undefined;

function obtenerRepositoriosMemoria(): RepositoriosMemoria {
  const entornoLocal =
    process.env.APP_ENV === "local" ||
    process.env.APP_ENV === "test" ||
    process.env.NODE_ENV === "test";
  if (process.env.PERSISTENCE !== "memory" || !entornoLocal) {
    throw Object.assign(new Error("PERSISTENCIA_NO_CONFIGURADA"), {
      code: "PERSISTENCIA_NO_CONFIGURADA",
    });
  }

  if (!repositoriosMemoria) {
    repositoriosMemoria = {
      citas: new MemoriaCitasRepository(),
      catalogo: new MemoriaCatalogoRepository(),
    };
  }
  return repositoriosMemoria;
}

export function obtenerServicioCitas(): CitasService {
  const repositorios = obtenerRepositoriosMemoria();
  if (!citasService) {
    // TODO: conectar aquí el repositorio de Azure SQL en otro PR.
    citasService = new CitasService(repositorios.citas, repositorios.catalogo);
  }
  return citasService;
}

export function obtenerRepositorioCatalogo(): MemoriaCatalogoRepository {
  return obtenerRepositoriosMemoria().catalogo;
}
