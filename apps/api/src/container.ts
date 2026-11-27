import { CitasService } from "./services/citasService";
import {
  CatalogoRepository,
  CitasRepository,
} from "./repositories/citasRepository";
import {
  MemoriaCatalogoRepository,
  MemoriaCitasRepository,
} from "./repositories/memoriaRepository";
import { AzureSqlRepository } from "./repositories/azureSqlRepository";

interface Repositorios {
  citas: CitasRepository;
  catalogo: CatalogoRepository;
}

interface RepositoriosMemoria extends Repositorios {
  citas: MemoriaCitasRepository;
  catalogo: MemoriaCatalogoRepository;
}

let repositoriosMemoria: RepositoriosMemoria | undefined;
let repositorioSql: AzureSqlRepository | undefined;
let servicioCitas: CitasService | undefined;
let citasDeServicio: CitasRepository | undefined;
let catalogoDeServicio: CatalogoRepository | undefined;

function persistenciaNoConfigurada(): never {
  throw Object.assign(new Error("PERSISTENCIA_NO_CONFIGURADA"), {
    code: "PERSISTENCIA_NO_CONFIGURADA",
  });
}

function obtenerRepositoriosMemoria(): RepositoriosMemoria {
  const appEnv = process.env.APP_ENV;
  const entornoLocal =
    appEnv === undefined
      ? process.env.NODE_ENV === "test"
      : appEnv === "local" || appEnv === "test";
  if (!entornoLocal) return persistenciaNoConfigurada();

  if (!repositoriosMemoria) {
    repositoriosMemoria = {
      citas: new MemoriaCitasRepository(),
      catalogo: new MemoriaCatalogoRepository(),
    };
  }
  return repositoriosMemoria;
}

function obtenerRepositorios(): Repositorios {
  switch (process.env.PERSISTENCE) {
    case "memory":
      return obtenerRepositoriosMemoria();
    case "sql":
      if (!process.env.SQL_SERVER?.trim() || !process.env.SQL_DATABASE?.trim()) {
        return persistenciaNoConfigurada();
      }
      if (!repositorioSql) repositorioSql = new AzureSqlRepository();
      return { citas: repositorioSql, catalogo: repositorioSql };
    default:
      return persistenciaNoConfigurada();
  }
}

export function obtenerServicioCitas(): CitasService {
  const repositorios = obtenerRepositorios();
  if (
    !servicioCitas ||
    citasDeServicio !== repositorios.citas ||
    catalogoDeServicio !== repositorios.catalogo
  ) {
    servicioCitas = new CitasService(
      repositorios.citas,
      repositorios.catalogo
    );
    citasDeServicio = repositorios.citas;
    catalogoDeServicio = repositorios.catalogo;
  }
  return servicioCitas;
}

export function obtenerRepositorioCatalogo(): CatalogoRepository {
  return obtenerRepositorios().catalogo;
}
