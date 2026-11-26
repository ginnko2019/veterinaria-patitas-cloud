import { CitasService } from "./services/citasService";
import {
  MemoriaCatalogoRepository,
  MemoriaCitasRepository,
} from "./repositories/memoriaRepository";

const citasRepository = new MemoriaCitasRepository();
const catalogoRepository = new MemoriaCatalogoRepository();

// Se reemplazará por el repositorio de Azure SQL en otro PR.
const citasService = new CitasService(citasRepository, catalogoRepository);

export function obtenerServicioCitas(): CitasService {
  return citasService;
}

export function obtenerRepositorioCatalogo(): MemoriaCatalogoRepository {
  return catalogoRepository;
}
