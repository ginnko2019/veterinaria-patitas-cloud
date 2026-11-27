/*
  Bootstrap administrativo de acceso SQL para la Function de Patitas DEV.
  Ejecutar como administrador de Microsoft Entra, en un lote independiente
  conectado a patitas-dev. No ejecutarlo con la identidad de la aplicacion.

  Sustituir SOLO @clientId por el application/client ID de la identidad
  administrada SystemAssigned de la Function. NO usar su principal/object ID.
  Este dato se verifica antes de ejecutar: SQL no lo consulta en Entra.

  Fuente: Microsoft Learn, CREATE USER, ejemplo K (Azure SQL Database).
  https://learn.microsoft.com/en-us/sql/t-sql/statements/create-user-transact-sql?view=azuresqldb-current#k-create-a-contained-database-user-from-a-microsoft-entra-principal-without-validation

  Este archivo no crea tablas, migraciones ni datos de negocio. Concede solo
  SELECT, INSERT y UPDATE sobre dbo; no revoca permisos previamente existentes.
*/

SET NOCOUNT ON;

-- Evitar que un ROLLBACK del bootstrap afecte una transaccion del operador.
IF @@TRANCOUNT <> 0
BEGIN
    RAISERROR(N'Ejecute el bootstrap en un lote sin transaccion abierta.', 16, 1);
    RETURN;
END;

IF DB_NAME() <> N'patitas-dev'
    THROW 51000, N'Bootstrap restringido a la base patitas-dev.', 1;

DECLARE @clientId uniqueidentifier = '00000000-0000-0000-0000-000000000000';

IF @clientId IS NULL
   OR @clientId = '00000000-0000-0000-0000-000000000000'
    THROW 51001, N'Sustituya @clientId por el client ID verificado de la identidad administrada DEV.', 1;

DECLARE @userName sysname = N'patitas-api-dev';
DECLARE @roleName sysname = N'patitas_api_runtime';
DECLARE @expectedSid binary(16) = CONVERT(binary(16), @clientId);
DECLARE @sidHex varchar(34) = CONVERT(varchar(34), @expectedSid, 1);
DECLARE @command nvarchar(max);

SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    -- Una reejecucion no debe reasignar silenciosamente un usuario existente.
    IF EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE name = @userName
          AND ([type] <> 'E' OR sid IS NULL OR sid <> @expectedSid
               OR DATALENGTH(sid) <> 16)
    )
        THROW 51002, N'patitas-api-dev ya existe con otro SID o tipo. Reviselo sin reemplazarlo automaticamente.', 1;

    IF EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE name = @roleName
          AND ([type] <> 'R' OR is_fixed_role = 1)
    )
        THROW 51003, N'patitas_api_runtime ya existe y no es el rol personalizado esperado.', 1;

    IF EXISTS (
        SELECT 1
        FROM sys.database_principals
        WHERE sid = @expectedSid AND name <> @userName
    )
        THROW 51004, N'El client ID ya esta asociado a otro usuario SQL. Revise ese acceso antes de continuar.', 1;

    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @userName)
    BEGIN
        -- Solo se concatenan identificadores escapados y un literal hexadecimal
        -- producido desde un uniqueidentifier; no hay sustituciones SQLCMD.
        SET @command = N'CREATE USER ' + QUOTENAME(@userName)
            + N' WITH SID = ' + @sidHex
            + N', TYPE = E, DEFAULT_SCHEMA = [dbo];';
        EXEC sys.sp_executesql @command;
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @roleName)
    BEGIN
        SET @command = N'CREATE ROLE ' + QUOTENAME(@roleName)
            + N' AUTHORIZATION [dbo];';
        EXEC sys.sp_executesql @command;
    END;

    -- Alcance DEV propuesto para las tablas de negocio en dbo. Cancelar es UPDATE.
    -- No se conceden DELETE, DDL, db_datawriter ni db_owner a la aplicacion.
    SET @command = N'GRANT SELECT, INSERT, UPDATE ON SCHEMA::[dbo] TO '
        + QUOTENAME(@roleName) + N';';
    EXEC sys.sp_executesql @command;

    IF NOT EXISTS (
        SELECT 1
        FROM sys.database_role_members
        WHERE role_principal_id = DATABASE_PRINCIPAL_ID(@roleName)
          AND member_principal_id = DATABASE_PRINCIPAL_ID(@userName)
    )
    BEGIN
        SET @command = N'ALTER ROLE ' + QUOTENAME(@roleName)
            + N' ADD MEMBER ' + QUOTENAME(@userName) + N';';
        EXEC sys.sp_executesql @command;
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
    THROW;
END CATCH;

-- Evidencia del principal y de los permisos concedidos al rol en esta base.
SELECT DB_NAME() AS database_name, name AS database_user, type_desc,
       CONVERT(uniqueidentifier, sid) AS managed_identity_client_id
FROM sys.database_principals
WHERE name = @userName;

SELECT p.state_desc, p.permission_name, SCHEMA_NAME(p.major_id) AS schema_name
FROM sys.database_permissions AS p
WHERE p.grantee_principal_id = DATABASE_PRINCIPAL_ID(@roleName)
  AND p.class = 3;
