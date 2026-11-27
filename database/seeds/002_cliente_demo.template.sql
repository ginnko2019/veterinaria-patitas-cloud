DECLARE @cliente_id UNIQUEIDENTIFIER = NEWID();

INSERT INTO dbo.Clientes (id, identity_id, nombre)
VALUES (@cliente_id, N'$(IDENTITY_ID)', N'$(NOMBRE_CLIENTE)');

INSERT INTO dbo.Mascotas (cliente_id, nombre)
VALUES (@cliente_id, N'$(NOMBRE_MASCOTA)');
