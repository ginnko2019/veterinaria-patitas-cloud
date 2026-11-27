'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { readConfig, assertTerraformOwnership, sanitize, createAzureCli, deploy } = require('./deploy-api-dev.cjs');

const env = {
  AZURE_SUBSCRIPTION_ID: '11111111-1111-1111-1111-111111111111',
  AZURE_TENANT_ID: '22222222-2222-2222-2222-222222222222',
  AZURE_CLIENT_ID: '33333333-3333-3333-3333-333333333333',
  TF_NAME_SUFFIX: 'test1234', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  TF_RESOURCE_GROUP_ID: '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-patitas-dev',
};
const now = Date.parse('2026-01-01T12:00:00Z');
const syntheticKey = 'SYNTHETIC_ACCOUNT_KEY_FOR_TEST';
const syntheticSig = 'SYNTHETIC_SIGNATURE_FOR_TEST';
const config = readConfig(env);

function fixture(change = {}) {
  const calls = [];
  const progress = [];
  const secrets = [];
  let settingsPath;
  let written;
  const settings = {
    APP_ENV: 'dev', PERSISTENCE: 'sql', SQL_SERVER_FQDN: 'sql-patitas-dev-test1234-westcentralus.database.windows.net',
    SQL_DATABASE_NAME: 'patitas-dev', SQL_AUTH_MODE: 'managed-identity', TRUST_SWA_PRINCIPAL: 'false',
    FUNCTIONS_WORKER_RUNTIME: 'node',
    AzureWebJobsStorage: `DefaultEndpointsProtocol=https;AccountName=${config.storage};AccountKey=${syntheticKey};EndpointSuffix=core.windows.net`,
    ...change.settings,
  };
  const az = (args, options = {}) => {
    calls.push({ args, options });
    const command = args.slice(0, 4).join(' ');
    if (args[0] === 'account') return { id: config.subscription, tenantId: config.tenant, state: 'Enabled' };
    if (args[0] === 'functionapp' && args[1] === 'show') return {
      id: `${config.groupId}/providers/Microsoft.Web/sites/${config.app}`, reserved: null, kind: 'functionapp,linux',
      tags: { proyecto: 'veterinaria-patitas', ambiente: 'dev' },
      identity: { principalId: '44444444-4444-4444-4444-444444444444' },
      serverFarmId: `${config.groupId}/providers/Microsoft.Web/serverfarms/asp-patitas-dev`,
      defaultHostName: change.functionHostname ?? `${config.app}.azurewebsites.net`,
    };
    if (args[0] === 'rest' && args[1] === '--method' && args[2] === 'get') {
      const url = args[args.indexOf('--url') + 1];
      if (url.includes('/serverfarms/')) return {
        id: `${config.groupId}/providers/Microsoft.Web/serverfarms/asp-patitas-dev`,
        sku: { name: change.sku || 'Y1' },
        properties: { reserved: change.planLinux ?? true, provisioningState: change.planState || 'Succeeded' },
      };
      if (url.includes('/sites/')) return {
        id: `${config.groupId}/providers/Microsoft.Web/sites/${config.app}`,
        properties: {
          reserved: change.appLinux ?? true,
          serverFarmId: change.appPlanId ?? `${config.groupId}/providers/Microsoft.Web/serverfarms/asp-patitas-dev`,
        },
      };
      throw new Error('ARM recurso inesperado en prueba');
    }
    if (command.startsWith('functionapp config show')) return 'NODE|22';
    if (command === 'functionapp config appsettings list') {
      return Object.entries({ ...settings, ...written }).map(([name, value]) => ({ name, value }));
    }
    if (command.startsWith('storage account show')) return {
      id: `${config.groupId}/providers/Microsoft.Storage/storageAccounts/${config.storage}`,
      allowBlobPublicAccess: false, enableHttpsTrafficOnly: true,
      tags: { proyecto: 'veterinaria-patitas', ambiente: 'dev' },
    };
    if (args[0] === 'staticwebapp') return {
      id: `${config.groupId}/providers/Microsoft.Web/staticSites/${config.swa}`,
      defaultHostname: change.swaHostname ?? 'patitas-test.azurestaticapps.net',
    };
    if (command.startsWith('storage container-rm list')) return [{
      id: `${config.groupId}/providers/Microsoft.Storage/storageAccounts/${config.storage}/blobServices/default/containers/function-releases`,
      name: 'function-releases', publicAccess: change.publicAccess || 'None',
    }];
    if (command.startsWith('storage blob upload')) return undefined;
    if (command.startsWith('storage blob generate-sas')) {
      const expiry = args[args.indexOf('--expiry') + 1];
      return `sv=2024-11-04&sr=b&spr=https&sp=${change.sasPermissions || 'r'}&se=${encodeURIComponent(expiry)}&sig=${syntheticSig}`;
    }
    if (command === 'functionapp config appsettings set') {
      settingsPath = args[args.indexOf('--settings') + 1].slice(1);
      written = JSON.parse(readFileSync(settingsPath, 'utf8'));
      return undefined;
    }
    if (args[0] === 'functionapp' && args[1] === 'restart') return undefined;
    if (args[0] === 'rest') {
      if (change.syncFails) throw new Error('SyncFailed: host no disponible');
      return undefined;
    }
    throw new Error(`Comando de prueba inesperado: ${command}`);
  };
  return { calls, progress, secrets, options: { az, secrets, now, wait: async () => {}, progress: message => progress.push(message) },
    get written() { return written; }, get settingsPath() { return settingsPath; } };
}

test('rechaza rama o grupo/suscripcion incorrectos antes de usar Azure', () => {
  assert.throws(() => readConfig({ ...env, GITHUB_REF: 'refs/heads/otra' }), /main/);
  assert.throws(() => readConfig({ ...env, TF_RESOURCE_GROUP_ID: env.TF_RESOURCE_GROUP_ID.replace('dev', 'prod') }), /DEV/);
});

test('exige que Terraform preserve el setting; un comentario no basta', () => {
  assert.throws(() => assertTerraformOwnership('# ignore_changes = [app_settings["WEBSITE_RUN_FROM_PACKAGE"]]'), /Integrar/);
  assert.throws(() => assertTerraformOwnership('ignore_changes = [auth_settings_v2]'), /Integrar/);
  assert.doesNotThrow(() => assertTerraformOwnership('ignore_changes = [auth_settings_v2, app_settings["WEBSITE_RUN_FROM_PACKAGE"]]'));
});

test('diagnostico conserva codigo Azure y elimina clave, URL SAS y token', () => {
  const input = `AuthorizationFailure: https://account.blob.core.windows.net/container/file.zip?sp=r&sig=${syntheticSig} AccountKey=${syntheticKey}; Bearer JWT_SYNTHETIC_TOKEN`;
  const output = sanitize(input, [syntheticKey, syntheticSig]);
  assert.match(output, /AuthorizationFailure/);
  for (const secret of [syntheticKey, syntheticSig, 'JWT_SYNTHETIC_TOKEN', '?sp=r']) assert.ok(!output.includes(secret));
});

test('Azure CLI no hereda stdout/stderr ni expone respuesta JSON invalida', () => {
  const az = createAzureCli(config, [syntheticKey], (_file, args, options) => {
    assert.equal(options.encoding, 'utf8');
    assert.equal(options.stdio, undefined);
    assert.ok(args.includes(config.subscription));
    return { status: 1, stderr: `AuthenticationFailed: ${syntheticKey}` };
  });
  assert.throws(() => az(['storage', 'blob', 'upload']), error =>
    error.message.includes('AuthenticationFailed') && !error.message.includes(syntheticKey));
  const invalid = createAzureCli(config, [], () => ({ status: 0, stdout: 'SYNTHETIC_UNEXPECTED_SECRET' }));
  assert.throws(() => invalid(['account', 'show']), error => !error.message.includes('SYNTHETIC_UNEXPECTED_SECRET'));
});

test('publica solo el setting de paquete, SAS lectura/HTTPS 30 dias y resultados sin secretos', async () => {
  const f = fixture();
  const result = await deploy(config, '/tmp/synthetic-package.zip', f.options);
  assert.deepEqual(Object.keys(f.written), ['WEBSITE_RUN_FROM_PACKAGE']);
  assert.equal(existsSync(f.settingsPath), false);
  assert.equal(Date.parse(result.package_expires_utc) - now, 30 * 86400000);
  assert.equal(result.trust_swa_principal, 'false');
  const upload = f.calls.find(call => call.args.includes('upload'));
  assert.ok(upload.args.includes('false'));
  assert.ok(!upload.args.some(arg => arg.includes(syntheticKey)));
  assert.ok(upload.options.env.AZURE_STORAGE_CONNECTION_STRING.includes(syntheticKey));
  const sas = f.calls.find(call => call.args.includes('generate-sas'));
  assert.equal(sas.args[sas.args.indexOf('--permissions') + 1], 'r');
  assert.ok(sas.args.includes('--https-only'));
  assert.ok(!JSON.stringify({ result, progress: f.progress }).includes(syntheticSig));
  assert.ok(!JSON.stringify({ result, progress: f.progress }).includes(syntheticKey));
});

for (const [name, change, error] of [
  ['plan distinto', { sku: 'EP1' }, /Y1/],
  ['plan Windows informado por ARM', { planLinux: false }, /Linux Consumption/],
  ['plan ARM sin estado Succeeded', { planState: 'Failed' }, /aprovisionado/],
  ['Function Windows informada por ARM', { appLinux: false }, /Function Linux/],
  ['Function apuntando a otro plan ARM', { appPlanId: '/subscriptions/other/resourceGroups/other/providers/Microsoft.Web/serverfarms/other' }, /plan esperado/],
  ['servidor SQL ajeno', { settings: { SQL_SERVER_FQDN: 'otro-servidor.database.windows.net' } }, /SQL DEV/],
  ['contenedor publico', { publicAccess: 'Blob' }, /privado/],
]) {
  test(`no sube el paquete con ${name}`, async () => {
    const f = fixture(change);
    await assert.rejects(() => deploy(config, '/tmp/synthetic-package.zip', f.options), error);
    assert.equal(f.calls.some(call => call.args.includes('upload')), false);
  });
}

test('acepta hostnames Azure con etiquetas de particion y region', async () => {
  const f = fixture({
    swaHostname: 'orange-pond-0a04b7203.2.azurestaticapps.net',
    functionHostname: 'myapp-hash.westus-01.azurewebsites.net',
  });
  const result = await deploy(config, '/tmp/synthetic-package.zip', f.options);
  assert.equal(result.swa_api_url, 'https://orange-pond-0a04b7203.2.azurestaticapps.net/api');
  assert.equal(result.function_direct_url, 'https://myapp-hash.westus-01.azurewebsites.net/api');
});

test('rechaza DNS malicioso, sufijo ajeno, rutas, userinfo y puertos antes de subir', async () => {
  for (const [field, suffix] of [['swaHostname', 'azurestaticapps.net'], ['functionHostname', 'azurewebsites.net']]) {
    for (const hostname of [
      `app.${suffix}.example.com`, `app.evil${suffix}`, `${suffix}`, `app..${suffix}`,
      `https://app.${suffix}`, `app.${suffix}/api`, `user@app.${suffix}`, `app.${suffix}:443`,
      `app.${suffix}?x=1`, `app.${suffix}#fragment`, `bad_label.${suffix}`, `-bad.${suffix}`,
      `app\n.sub.${suffix}`, `app\r.sub.${suffix}`,
    ]) {
      const f = fixture({ [field]: hostname });
      await assert.rejects(() => deploy(config, '/tmp/synthetic-package.zip', f.options), /origenes DEV/);
      assert.equal(f.calls.some(call => call.args.includes('upload')), false);
    }
  }
});

test('redeploy conserva confianza true y la informa sin escribirla', async () => {
  const f = fixture({ settings: { TRUST_SWA_PRINCIPAL: 'true' } });
  const result = await deploy(config, '/tmp/synthetic-package.zip', f.options);
  assert.equal(result.trust_swa_principal, 'true');
  assert.deepEqual(Object.keys(f.written), ['WEBSITE_RUN_FROM_PACKAGE']);
});

test('confianza ausente, booleana o string invalido bloquea la publicacion', async () => {
  for (const value of [undefined, null, true, false, '', 'TRUE', 'false ']) {
    const f = fixture({ settings: { TRUST_SWA_PRINCIPAL: value } });
    await assert.rejects(() => deploy(config, '/tmp/synthetic-package.zip', f.options), /TRUST_SWA/);
    assert.equal(f.calls.some(call => call.args.includes('upload')), false);
  }
});

test('un SAS con escritura no cambia la Function', async () => {
  const f = fixture({ sasPermissions: 'rw' });
  await assert.rejects(() => deploy(config, '/tmp/synthetic-package.zip', f.options), /SAS/);
  assert.equal(f.written, undefined);
});

test('sync fallido agota tres intentos y falla; no declara despliegue verificado', async () => {
  const f = fixture({ syncFails: true });
  await assert.rejects(() => deploy(config, '/tmp/synthetic-package.zip', f.options), /SyncFailed/);
  assert.equal(f.calls.filter(call => call.args[0] === 'rest' && call.args[2] === 'post').length, 3);
});

test('verifica Linux Y1 consultando ARM aunque Azure CLI no exponga reserved', async () => {
  const f = fixture();
  await deploy(config, '/tmp/synthetic-package.zip', f.options);
  const queries = f.calls.filter(call => call.args[0] === 'rest' && call.args[2] === 'get');
  assert.equal(queries.length, 2);
  assert.ok(queries.some(call => call.args.some(arg => arg.includes('/serverfarms/asp-patitas-dev?api-version=2024-11-01'))));
  assert.ok(queries.some(call => call.args.some(arg => arg.includes('/sites/func-patitas-dev-test1234?api-version=2024-11-01'))));
});
