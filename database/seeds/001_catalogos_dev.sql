MERGE dbo.Veterinarios AS target
USING (VALUES
  (CONVERT(UNIQUEIDENTIFIER, '6baec109-23fc-4715-9154-9ab1a86f436f'), N'Veterinaria Ana'),
  (CONVERT(UNIQUEIDENTIFIER, 'b12a9c50-fd45-4c75-9e3e-fcf8deecaf02'), N'Veterinario Luis'),
  (CONVERT(UNIQUEIDENTIFIER, 'd2e0d9c3-0be7-45f7-9b3e-2a4fd1af3ad8'), N'Veterinaria Sofia')
) AS source(id, nombre)
ON target.id = source.id
WHEN MATCHED THEN UPDATE SET nombre = source.nombre
WHEN NOT MATCHED THEN INSERT (id, nombre) VALUES (source.id, source.nombre);

MERGE dbo.Servicios AS target
USING (VALUES
  (CONVERT(UNIQUEIDENTIFIER, '5b442a3a-8a08-4760-82d9-97e67971c7bf'), N'Consulta general', 30),
  (CONVERT(UNIQUEIDENTIFIER, '1fe2c6c1-1a45-42f4-bd0b-726c4f3e1caa'), N'Vacunacion', 30)
) AS source(id, nombre, duracion_minutos)
ON target.id = source.id
WHEN MATCHED THEN UPDATE SET
  nombre = source.nombre,
  duracion_minutos = source.duracion_minutos
WHEN NOT MATCHED THEN
  INSERT (id, nombre, duracion_minutos)
  VALUES (source.id, source.nombre, source.duracion_minutos);
