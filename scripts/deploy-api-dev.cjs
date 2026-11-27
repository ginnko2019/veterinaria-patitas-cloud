'use strict';

// Publicacion DEV: OIDC -> ARM y Storage existente -> paquete privado con SAS de 30 dias.
// Nunca imprimir settings, claves, URLs SAS ni la salida cruda de Azure CLI.
const { spawnSync } = require('node:child_process');
const { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAS_DAYS = 30;
const CONTAINER = 'function-releases';
const PRESERVED = ['APP_ENV', 'PERSISTENCE', 'SQL_SERVER_FQDN', 'SQL_DATABASE_NAME', 'SQL_AUTH_MODE', 'TRUST_SWA_PRINCIPAL'];
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const sameId = (actual, expected) => typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();

function isAzureHostname(value, suffix) {
  return typeof value === 'string' && value.length <= 253 &&
    !/[^a-z0-9.-]/i.test(value) &&
    value.toLowerCase().endsWith(`.${suffix}`) &&
    value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function readConfig(env = process.env) {
  for (const name of ['AZURE_SUBSCRIPTION_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID']) {
    requireThat(GUID.test(env[name] || ''), `${name} requiere un GUID en minusculas.`);
  }
  const suffix = env.TF_NAME_SUFFIX || '';
  requireThat(/^[a-z0-9]{4,10}$/.test(suffix), 'TF_NAME_SUFFIX no es valido.');
  requireThat(env.GITHUB_REF === 'refs/heads/main', 'Solo se publica desde main.');
  requireThat(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || ''), 'Falta el SHA del codigo revisado.');
  requireThat(/^\d+$/.test(env.GITHUB_RUN_ID || '') && /^\d+$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'Falta la identificacion de la ejecucion.');
  const group = 'rg-patitas-dev';
  const groupId = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${group}`;
  requireThat(env.TF_RESOURCE_GROUP_ID === groupId, 'TF_RESOURCE_GROUP_ID no corresponde a DEV en esta suscripcion.');
  return {
    subscription: env.AZURE_SUBSCRIPTION_ID, tenant: env.AZURE_TENANT_ID,
    group, groupId, app: `func-patitas-dev-${suffix}`, swa: `swa-patitas-dev-${suffix}`,
    storage: `stpatdev${suffix}`, sqlServer: `sql-patitas-dev-${suffix}-westcentralus.database.windows.net`, sha: env.GITHUB_SHA,
    blob: `${env.GITHUB_SHA}-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.zip`,
  };
}

function assertTerraformOwnership(hcl) {
  const withoutComments = hcl.replace(/#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  requireThat(/ignore_changes\s*=\s*\[[\s\S]*?app_settings\["WEBSITE_RUN_FROM_PACKAGE"\]/.test(withoutComments),
    'Integrar primero ignore_changes de WEBSITE_RUN_FROM_PACKAGE en Terraform.');
}

function sanitize(text, secrets = []) {
  let result = String(text || '');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTADO]');
  }
  return result
    .replace(/https:\/\/[^\s"'<>]*\.blob\.core\.windows\.net\/[^\s"'<>]*\?[^\s"'<>]*/gi, '[URL DE PAQUETE REDACTADA]')
    .replace(/(AccountKey=)[^;\s"']+/gi, '$1[REDACTADO]')
    .replace(/((?:[?&]|\b)sig=)[^&\s"']+/gi, '$1[REDACTADO]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTADO]')
    .replace(/(["']?(?:accessToken|access_token|client_secret)["']?\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTADO]');
}

function createAzureCli(config, secrets, spawn = spawnSync) {
  return (args, options = {}) => {
    const result = spawn('az', [...args, '--subscription', config.subscription, '--only-show-errors', '--output', options.none ? 'none' : 'json'], {
      encoding: 'utf8', timeout: options.timeout || 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, AZURE_CORE_OUTPUT: 'none', ...options.env },
    });
    if (result.error || result.status !== 0) {
      const detail = sanitize(result.stderr || result.error?.message || `exit=${result.status}`, secrets).slice(0, 1800);
      throw new Error(`Azure CLI: ${args.slice(0, 3).join(' ')}: ${detail}`);
    }
    if (options.none) return undefined;
    try { return JSON.parse(result.stdout); }
    catch { throw new Error(`Respuesta JSON invalida: ${args.slice(0, 3).join(' ')}.`); }
  };
}

function settingsMap(rows) {
  requireThat(Array.isArray(rows), 'Respuesta de settings invalida.');
  return Object.fromEntries(rows.map(item => [item.name, item.value]));
}

function storageCredential(connection, expectedAccount, secrets) {
  requireThat(typeof connection === 'string' && connection.length > 0, 'AzureWebJobsStorage no esta configurado.');
  secrets.push(connection);
  const fields = Object.fromEntries(connection.split(';').filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  if (fields.AccountKey) secrets.push(fields.AccountKey);
  requireThat(fields.DefaultEndpointsProtocol === 'https' && fields.AccountName === expectedAccount &&
    fields.EndpointSuffix === 'core.windows.net' && fields.AccountKey &&
    Object.keys(fields).every(key => ['DefaultEndpointsProtocol', 'AccountName', 'AccountKey', 'EndpointSuffix'].includes(key)),
  'AzureWebJobsStorage no corresponde al Storage HTTPS de este DEV.');
  return { AZURE_STORAGE_CONNECTION_STRING: connection };
}

async function deploy(config, zipPath, options = {}) {
  const secrets = options.secrets || [];
  const az = options.az || createAzureCli(config, secrets);
  const pause = options.wait || wait;
  const progress = options.progress || (message => console.error(message));
  const appArgs = ['--resource-group', config.group, '--name', config.app];
  const appId = `${config.groupId}/providers/Microsoft.Web/sites/${config.app}`;
  const storageId = `${config.groupId}/providers/Microsoft.Storage/storageAccounts/${config.storage}`;

  progress('Comprobando Function, runtime y configuracion DEV.');
  const account = az(['account', 'show']);
  requireThat(account.id === config.subscription && account.tenantId === config.tenant && account.state === 'Enabled', 'Sesion Azure distinta del tenant/suscripcion DEV habilitada.');
  const app = az(['functionapp', 'show', ...appArgs]);
  const appArm = az(['rest', '--method', 'get', '--url', `https://management.azure.com${appId}?api-version=2024-11-01`]);
  requireThat(sameId(appArm.id, appId) && appArm.properties?.reserved === true &&
    sameId(appArm.properties?.serverFarmId, `${config.groupId}/providers/Microsoft.Web/serverfarms/asp-patitas-dev`),
  'Azure ARM no confirmo la Function Linux ni el plan esperado.');
  requireThat(sameId(app.id, appId) && app.kind?.includes('functionapp') &&
    app.tags?.proyecto === 'veterinaria-patitas' && app.tags?.ambiente === 'dev' && GUID.test(app.identity?.principalId || ''),
  'Function inexistente, ajena o incompatible; no se publica.');
  const planId = `${config.groupId}/providers/Microsoft.Web/serverfarms/asp-patitas-dev`;
  requireThat(sameId(app.serverFarmId, planId), 'El plan de la Function no corresponde a DEV.');
  const plan = az(['rest', '--method', 'get', '--url', `https://management.azure.com${planId}?api-version=2024-11-01`]);
  requireThat(sameId(plan.id, planId) && plan.sku?.name === 'Y1' && plan.properties?.reserved === true &&
    plan.properties?.provisioningState === 'Succeeded',
  'Azure ARM no confirmo un plan Linux Consumption Y1 aprovisionado correctamente.');
  const runtime = az(['functionapp', 'config', 'show', ...appArgs, '--query', 'linuxFxVersion']);
  requireThat(runtime === 'NODE|22', 'El runtime debe ser Node 22.');
  const settings = settingsMap(az(['functionapp', 'config', 'appsettings', 'list', ...appArgs]));
  if (settings.WEBSITE_RUN_FROM_PACKAGE) secrets.push(settings.WEBSITE_RUN_FROM_PACKAGE);
  requireThat(settings.APP_ENV === 'dev' && settings.PERSISTENCE === 'sql' &&
    settings.SQL_DATABASE_NAME === 'patitas-dev' && settings.SQL_AUTH_MODE === 'managed-identity' &&
    sameId(settings.SQL_SERVER_FQDN, config.sqlServer) &&
    ['true', 'false'].includes(settings.TRUST_SWA_PRINCIPAL) && settings.FUNCTIONS_WORKER_RUNTIME === 'node',
  'Completar settings SQL DEV; TRUST_SWA_PRINCIPAL debe ser el string true o false y se conservara.');
  const blobEnv = storageCredential(settings.AzureWebJobsStorage, config.storage, secrets);
  const storage = az(['storage', 'account', 'show', '--resource-group', config.group, '--name', config.storage]);
  requireThat(sameId(storage.id, storageId) && storage.allowBlobPublicAccess === false &&
    storage.enableHttpsTrafficOnly === true && storage.allowSharedKeyAccess !== false &&
    storage.tags?.proyecto === 'veterinaria-patitas' && storage.tags?.ambiente === 'dev', 'Storage ajeno o incompatible.');
  const swa = az(['staticwebapp', 'show', '--resource-group', config.group, '--name', config.swa]);
  requireThat(sameId(swa.id, `${config.groupId}/providers/Microsoft.Web/staticSites/${config.swa}`) &&
    isAzureHostname(swa.defaultHostname, 'azurestaticapps.net') &&
    isAzureHostname(app.defaultHostName, 'azurewebsites.net'), 'No se confirmaron los dos origenes DEV.');

  progress('Preparando el contenedor privado del paquete.');
  const containerArgs = ['--resource-group', config.group, '--storage-account', config.storage];
  const containers = az(['storage', 'container-rm', 'list', ...containerArgs]);
  requireThat(Array.isArray(containers), 'Lista de contenedores invalida.');
  const matches = containers.filter(item => item.name === CONTAINER);
  requireThat(matches.length <= 1, 'Contenedor de paquetes ambiguo.');
  const container = matches[0] || az(['storage', 'container-rm', 'create', ...containerArgs,
    '--name', CONTAINER, '--public-access', 'off', '--fail-on-exist', '--metadata',
    'proyecto=veterinaria-patitas', 'ambiente=dev', 'uso=api-packages']);
  requireThat(sameId(container.id, `${storageId}/blobServices/default/containers/${CONTAINER}`) &&
    (container.publicAccess === 'None' || container.publicAccess == null), 'El contenedor debe ser privado.');

  progress('Subiendo un paquete nuevo; no se reemplazan blobs anteriores.');
  const blobArgs = ['--account-name', config.storage, '--container-name', CONTAINER, '--name', config.blob, '--auth-mode', 'key'];
  az(['storage', 'blob', 'upload', ...blobArgs, '--file', zipPath, '--overwrite', 'false',
    '--content-type', 'application/zip', '--no-progress'], { env: blobEnv, none: true, timeout: 600000 });
  const now = options.now || Date.now();
  const expiry = new Date(now + SAS_DAYS * 86400000).toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
  const sas = az(['storage', 'blob', 'generate-sas', ...blobArgs, '--permissions', 'r', '--https-only', '--expiry', expiry], { env: blobEnv });
  requireThat(typeof sas === 'string', 'Azure no devolvio un SAS valido.');
  secrets.push(sas);
  const sasFields = new URLSearchParams(sas);
  if (sasFields.get('sig')) secrets.push(sasFields.get('sig'));
  requireThat(sasFields.get('sp') === 'r' && sasFields.get('sr') === 'b' && sasFields.get('spr') === 'https' &&
    sasFields.get('sig') && Date.parse(sasFields.get('se')) === Date.parse(expiry), 'El SAS no tiene permisos/expiracion previstos.');
  const packageUrl = `https://${config.storage}.blob.core.windows.net/${CONTAINER}/${config.blob}?${sas}`;
  secrets.push(packageUrl);

  progress('Actualizando solo WEBSITE_RUN_FROM_PACKAGE y sincronizando triggers.');
  const temp = mkdtempSync(join(tmpdir(), 'patitas-api-settings-'));
  try {
    const settingsPath = join(temp, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ WEBSITE_RUN_FROM_PACKAGE: packageUrl }), { mode: 0o600 });
    az(['functionapp', 'config', 'appsettings', 'set', ...appArgs, '--settings', `@${settingsPath}`], { none: true });
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const after = settingsMap(az(['functionapp', 'config', 'appsettings', 'list', ...appArgs]));
  requireThat(after.WEBSITE_RUN_FROM_PACKAGE === packageUrl && PRESERVED.every(key => after[key] === settings[key]), 'No se confirmo el paquete o cambiaron settings ajenos a la publicacion.');
  az(['functionapp', 'restart', ...appArgs], { none: true });
  let syncError;
  for (let attempt = 0; attempt < 3; attempt++) {
    await pause(10000);
    try {
      az(['rest', '--method', 'post', '--url', `https://management.azure.com${appId}/syncfunctiontriggers?api-version=2024-11-01`], { none: true });
      syncError = undefined;
      break;
    } catch (error) { syncError = error; }
  }
  if (syncError) throw syncError;
  return {
    function_app_name: config.app, function_direct_url: `https://${app.defaultHostName}/api`,
    swa_api_url: `https://${swa.defaultHostname}/api`, package_expires_utc: expiry, commit: config.sha,
    trust_swa_principal: after.TRUST_SWA_PRINCIPAL,
  };
}

async function main() {
  const secrets = [];
  try {
    const config = readConfig();
    assertTerraformOwnership(readFileSync(resolve(__dirname, '../infra/terraform/main.tf'), 'utf8'));
    if (process.argv[2] === '--check' && process.argv.length === 3) return;
    requireThat(process.argv.length === 3, 'Uso: node scripts/deploy-api-dev.cjs /ruta/paquete.zip');
    const zipPath = resolve(process.argv[2]);
    requireThat(zipPath.endsWith('.zip') && statSync(zipPath).isFile() && statSync(zipPath).size > 0, 'Falta un ZIP de ejecucion no vacio.');
    const result = await deploy(config, zipPath, { secrets });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(sanitize(error.message, secrets));
    process.exitCode = 1;
  }
}

module.exports = { readConfig, assertTerraformOwnership, sanitize, createAzureCli, storageCredential, deploy };
if (require.main === module) void main();
