SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-- Todas las fechas se almacenan en UTC.
-- El valor canónico de la API (ISO 8601 con milisegundos .000Z) se guarda sin
-- milisegundos. La unicidad por inicio solo es válida con franjas fijas de 30 minutos.
IF OBJECT_ID(N'dbo.Clientes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Clientes (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Clientes_id DEFAULT NEWID(),
    identity_id NVARCHAR(128) NOT NULL,
    nombre NVARCHAR(100) NULL,
    creado_utc DATETIME2(0) NOT NULL CONSTRAINT DF_Clientes_creado_utc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Clientes PRIMARY KEY (id),
    CONSTRAINT UQ_Clientes_identity_id UNIQUE (identity_id)
  );
END;

IF OBJECT_ID(N'dbo.Mascotas', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Mascotas (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Mascotas_id DEFAULT NEWID(),
    cliente_id UNIQUEIDENTIFIER NOT NULL,
    nombre NVARCHAR(80) NOT NULL,
    CONSTRAINT PK_Mascotas PRIMARY KEY (id),
    CONSTRAINT FK_Mascotas_Clientes FOREIGN KEY (cliente_id) REFERENCES dbo.Clientes(id)
  );
END;

IF OBJECT_ID(N'dbo.Veterinarios', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Veterinarios (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Veterinarios_id DEFAULT NEWID(),
    nombre NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_Veterinarios PRIMARY KEY (id)
  );
END;

IF OBJECT_ID(N'dbo.Servicios', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Servicios (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Servicios_id DEFAULT NEWID(),
    nombre NVARCHAR(100) NOT NULL,
    duracion_minutos INT NOT NULL,
    CONSTRAINT PK_Servicios PRIMARY KEY (id)
  );
END;

IF OBJECT_ID(N'dbo.Citas', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Citas (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Citas_id DEFAULT NEWID(),
    cliente_id UNIQUEIDENTIFIER NOT NULL,
    mascota_id UNIQUEIDENTIFIER NOT NULL,
    veterinario_id UNIQUEIDENTIFIER NOT NULL,
    servicio_id UNIQUEIDENTIFIER NOT NULL,
    inicio_utc DATETIME2(0) NOT NULL,
    motivo NVARCHAR(200) NULL,
    estado NVARCHAR(20) NOT NULL,
    creado_utc DATETIME2(0) NOT NULL CONSTRAINT DF_Citas_creado_utc DEFAULT SYSUTCDATETIME(),
    cancelada_utc DATETIME2(0) NULL,
    CONSTRAINT PK_Citas PRIMARY KEY (id),
    CONSTRAINT FK_Citas_Clientes FOREIGN KEY (cliente_id) REFERENCES dbo.Clientes(id),
    CONSTRAINT FK_Citas_Mascotas FOREIGN KEY (mascota_id) REFERENCES dbo.Mascotas(id),
    CONSTRAINT FK_Citas_Veterinarios FOREIGN KEY (veterinario_id) REFERENCES dbo.Veterinarios(id),
    CONSTRAINT FK_Citas_Servicios FOREIGN KEY (servicio_id) REFERENCES dbo.Servicios(id),
    CONSTRAINT CK_Citas_estado CHECK (estado IN (N'PROGRAMADA', N'CANCELADA'))
  );
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Mascotas')
    AND name = N'IX_Mascotas_cliente_id'
)
  CREATE INDEX IX_Mascotas_cliente_id ON dbo.Mascotas(cliente_id);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Citas')
    AND name = N'IX_Citas_cliente_id'
)
  CREATE INDEX IX_Citas_cliente_id ON dbo.Citas(cliente_id);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Citas')
    AND name = N'UX_Citas_Veterinario_Inicio_Activa'
)
  CREATE UNIQUE INDEX UX_Citas_Veterinario_Inicio_Activa
    ON dbo.Citas(veterinario_id, inicio_utc)
    WHERE estado = N'PROGRAMADA';
