#!/usr/bin/env bash
set -euo pipefail

# Bootstrap del estado y RBAC; ejecutar con una cuenta administradora autorizada.
# Los cinco providers corresponden al HCL actual (SystemAssigned pertenece a Web).
# Referencias: learn.microsoft.com/cli/azure/storage/container-rm
#              learn.microsoft.com/cli/azure/storage/account/blob-service-properties
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
progress() { printf '%s\n' "$*" >&2; }
usage() {
  printf '%s\n' 'Uso: bootstrap-azure-dev.sh --subscription-id GUID --tenant-id GUID --client-id GUID --service-principal-id GUID --name-suffix SUFIJO --location REGION'
}
subscription_id= tenant_id= client_id= service_principal_id= name_suffix= location=
while (($#)); do
  [[ "$1" != --help ]] || { usage; exit 0; }
  (($# >= 2)) || fail "Falta el valor de $1."
  case "$1" in
    --subscription-id) subscription_id=$2 ;;
    --tenant-id) tenant_id=$2 ;;
    --client-id) client_id=$2 ;;
    --service-principal-id) service_principal_id=$2 ;;
    --name-suffix) name_suffix=$2 ;;
    --location) location=$2 ;;
    *) fail "Parametro desconocido: $1" ;;
  esac
  shift 2
done
uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
for parameter in subscription_id tenant_id client_id service_principal_id; do
  [[ ${!parameter} =~ $uuid ]] || fail "$parameter requiere un GUID en minusculas."
done
[[ $name_suffix =~ ^[a-z0-9]{4,10}$ ]] || fail 'name-suffix requiere 4-10 caracteres [a-z0-9].'
[[ $location =~ ^[a-z0-9]+$ ]] || fail 'location requiere el nombre corto de la region.'
command -v az >/dev/null || fail 'Azure CLI no esta disponible.'
command -v jq >/dev/null || fail 'jq no esta disponible.'

runtime_rg=rg-patitas-dev
state_rg=rg-patitas-tfstate-dev
storage_name="stpatitasstate${name_suffix}"
container_name=tfstate
runtime_id="/subscriptions/$subscription_id/resourceGroups/$runtime_rg"
state_id="/subscriptions/$subscription_id/resourceGroups/$state_rg"
storage_id="$state_id/providers/Microsoft.Storage/storageAccounts/$storage_name"
container_id="$storage_id/blobServices/default/containers/$container_name"
contributor_role=b24988ac-6180-42a0-ab88-20f7382dd24c
blob_role=ba92f5b4-2d11-453d-a403-e96b0029c9fe
runtime_tags='{"proyecto":"veterinaria-patitas","ambiente":"dev","curso":"pemu-2026","gestion":"terraform"}'
state_tags='{"proyecto":"veterinaria-patitas","ambiente":"dev","gestion":"bootstrap","uso":"tfstate"}'
arm() { az "$@" --subscription "$subscription_id" --only-show-errors -o json; }

# Graph utiliza el tenant de la sesion; ARM siempre recibe la suscripcion explicita.
session="$(az account show --only-show-errors -o json)"
jq -e --arg tenant "$tenant_id" '.tenantId == $tenant' <<<"$session" >/dev/null || fail 'Tenant de sesion inesperado.'
account="$(arm account show)"
jq -e --arg tenant "$tenant_id" --arg sub "$subscription_id" \
  '.tenantId == $tenant and .id == $sub and .state == "Enabled"' <<<"$account" >/dev/null || fail 'Suscripcion o tenant inesperados.'
sp="$(az ad sp show --id "$service_principal_id" --only-show-errors -o json)"
jq -e --arg id "$service_principal_id" --arg client "$client_id" \
  '.id == $id and .appId == $client' <<<"$sp" >/dev/null || fail 'El service principal no corresponde al client-id.'

ensure_group() {
  local name=$1 expected_tags=$2 existing record tag_args
  progress "Grupo: comprobando $name."
  existing="$(arm group exists --name "$name")"
  case "$existing" in
    true) record="$(arm group show --name "$name")" ;;
    false)
      tag_args="$(jq -er 'to_entries | map("\(.key)=\(.value)") | join(" ")' <<<"$expected_tags")"
      # Tags constantes del proyecto; convertirlos en argumentos sin eval.
      local -a tags
      read -r -a tags <<<"$tag_args"
      record="$(arm group create --name "$name" --location "$location" --tags "${tags[@]}")"
      ;;
    *) fail "No se pudo determinar si existe $name." ;;
  esac
  jq -e --arg id "/subscriptions/$subscription_id/resourceGroups/$name" \
    --arg location "$location" --argjson tags "$expected_tags" '
    (.id|ascii_downcase) == ($id|ascii_downcase) and .location == $location and
    (.tags as $actual | all($tags|to_entries[]; $actual[.key] == .value))
  ' <<<"$record" >/dev/null || fail "RG $name ajeno o incompatible; no se modifico."
}
ensure_group "$runtime_rg" "$runtime_tags"
ensure_group "$state_rg" "$state_tags"

for namespace in Microsoft.Storage Microsoft.Web Microsoft.Insights Microsoft.OperationalInsights Microsoft.Sql; do
  progress "Provider: comprobando $namespace."
  provider="$(arm provider show --namespace "$namespace")"
  status="$(jq -er --arg ns "$namespace" 'select(.namespace == $ns) | .registrationState | select(type == "string")' <<<"$provider")"
  case "$status" in
    Registered) ;;
    NotRegistered|Unregistered|Registering)
      progress "Provider: registrando $namespace; esperando a Azure."
      arm provider register --namespace "$namespace" --wait >/dev/null
      ;;
    *) fail "Estado inesperado del provider $namespace: $status" ;;
  esac
done

progress "Storage: comprobando $storage_name."
accounts="$(arm storage account list --resource-group "$state_rg")"
matches="$(jq -ce --arg name "$storage_name" '
  if type == "array" then [.[]|select(.name == $name)] else error("Lista Storage invalida") end
' <<<"$accounts")"
case "$(jq -r length <<<"$matches")" in
  0)
    available="$(arm storage account check-name --name "$storage_name")"
    jq -e '.nameAvailable == true' <<<"$available" >/dev/null || fail 'Nombre Storage ocupado; no se adopta una cuenta ajena.'
    progress "Storage: creando $storage_name."
    storage="$(arm storage account create --name "$storage_name" --resource-group "$state_rg" \
      --location "$location" --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 \
      --https-only true --allow-shared-key-access false --allow-blob-public-access false \
      --public-network-access Enabled --default-action Allow \
      --tags proyecto=veterinaria-patitas ambiente=dev gestion=bootstrap uso=tfstate)"
    ;;
  1) storage="$(jq -c '.[0]' <<<"$matches")" ;;
  *) fail 'Respuesta Storage ambigua.' ;;
esac
jq -e --arg id "$storage_id" --arg location "$location" --argjson tags "$state_tags" '
  (.id|ascii_downcase) == ($id|ascii_downcase) and .location == $location and
  .kind == "StorageV2" and .sku.name == "Standard_LRS" and
  .minimumTlsVersion == "TLS1_2" and .enableHttpsTrafficOnly == true and
  .allowSharedKeyAccess == false and .allowBlobPublicAccess == false and
  .publicNetworkAccess == "Enabled" and .networkRuleSet.defaultAction == "Allow" and
  (.isHnsEnabled // false) == false and
  (.tags as $actual | all($tags|to_entries[]; $actual[.key] == .value))
' <<<"$storage" >/dev/null || fail 'Cuenta Storage ajena o incompatible; no se modifico.'

# Paso separado y recuperable: completar protecciones sin reducir retenciones existentes.
progress 'Blobs: comprobando versionado y recuperacion del estado.'
properties="$(arm storage account blob-service-properties show --account-name "$storage_name" --resource-group "$state_rg")"
jq -e --arg id "$storage_id/blobServices/default" '(.id|ascii_downcase) == ($id|ascii_downcase)' <<<"$properties" >/dev/null || fail 'Respuesta blob-service invalida.'
blob_days="$(jq -er '(.deleteRetentionPolicy.days // 0) | if type == "number" then [7,.]|max else error("Retencion invalida") end' <<<"$properties")"
container_days="$(jq -er '(.containerDeleteRetentionPolicy.days // 0) | if type == "number" then [7,.]|max else error("Retencion invalida") end' <<<"$properties")"
if ! jq -e '.isVersioningEnabled == true and .deleteRetentionPolicy.enabled == true and
  .deleteRetentionPolicy.days >= 7 and .containerDeleteRetentionPolicy.enabled == true and
  .containerDeleteRetentionPolicy.days >= 7' <<<"$properties" >/dev/null; then
  progress 'Blobs: completando las protecciones del estado.'
  properties="$(arm storage account blob-service-properties update --account-name "$storage_name" --resource-group "$state_rg" \
    --enable-versioning true --enable-delete-retention true --delete-retention-days "$blob_days" \
    --enable-container-delete-retention true --container-delete-retention-days "$container_days")"
fi
jq -e '.isVersioningEnabled == true and .deleteRetentionPolicy.enabled == true and
  .deleteRetentionPolicy.days >= 7 and .containerDeleteRetentionPolicy.enabled == true and
  .containerDeleteRetentionPolicy.days >= 7' <<<"$properties" >/dev/null || fail 'No se confirmaron las protecciones del estado.'

progress "Contenedor: comprobando $container_name."
containers="$(arm storage container-rm list --storage-account "$storage_name" --resource-group "$state_rg")"
matches="$(jq -ce --arg name "$container_name" '
  if type == "array" then [.[]|select(.name == $name)] else error("Lista de contenedores invalida") end
' <<<"$containers")"
case "$(jq -r length <<<"$matches")" in
  0) container="$(arm storage container-rm create --storage-account "$storage_name" --resource-group "$state_rg" \
       --name "$container_name" --public-access off --fail-on-exist \
       --metadata proyecto=veterinaria-patitas ambiente=dev gestion=bootstrap uso=tfstate)" ;;
  1) container="$(jq -c '.[0]' <<<"$matches")" ;;
  *) fail 'Respuesta de contenedores ambigua.' ;;
esac
jq -e --arg id "$container_id" --argjson tags "$state_tags" '
  (.id|ascii_downcase) == ($id|ascii_downcase) and (.publicAccess // "None") == "None" and
  (.metadata as $actual | all($tags|to_entries[]; $actual[.key] == .value))
' <<<"$container" >/dev/null || fail 'Contenedor ajeno o incompatible; no se modifico.'

ensure_role() {
  local scope=$1 role=$2 label=$3 assignments exact assignment
  progress "RBAC: comprobando $label en $scope."
  assignments="$(arm role assignment list --assignee-object-id "$service_principal_id" --scope "$scope" \
    --include-inherited --fill-principal-name false --fill-role-definition-name false)"
  exact="$(jq -ce --arg principal "$service_principal_id" --arg scope "$scope" --arg role "$role" '
    if type != "array" then error("Lista RBAC invalida") else
      [.[]|select((.principalId|ascii_downcase) == $principal and
        (.roleDefinitionId|ascii_downcase|endswith("/" + $role)))] as $same_role |
      if any($same_role[]; (.condition // "") != "") then
        error("Asignacion RBAC exacta o heredada condicionada; no se amplia")
      else [$same_role[]|select((.scope|ascii_downcase) == ($scope|ascii_downcase))] |
        if length > 1 then error("Asignacion RBAC exacta ambigua") else . end
      end
    end' <<<"$assignments")"
  if [[ "$(jq -r length <<<"$exact")" == 0 ]]; then
    progress "RBAC: creando $label en el scope indicado."
    assignment="$(arm role assignment create --assignee-object-id "$service_principal_id" \
      --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope")"
  else
    assignment="$(jq -c '.[0]' <<<"$exact")"
  fi
  jq -e --arg principal "$service_principal_id" --arg scope "$scope" --arg role "$role" '
    (.principalId|ascii_downcase) == $principal and (.scope|ascii_downcase) == ($scope|ascii_downcase) and
    (.roleDefinitionId|ascii_downcase|endswith("/" + $role)) and (.condition // "") == ""
  ' <<<"$assignment" >/dev/null || fail 'No se confirmo el scope exacto de RBAC.'
}
ensure_role "$runtime_id" "$contributor_role" 'Contributor'
ensure_role "$container_id" "$blob_role" 'Storage Blob Data Contributor'

jq -n --arg rg "$state_rg" --arg storage "$storage_name" --arg container "$container_name" \
  --arg suffix "$name_suffix" --arg resource_group_id "$runtime_id" '{
  TF_STATE_RG:$rg, TF_STATE_STORAGE:$storage, TF_STATE_CONTAINER:$container,
  TF_NAME_SUFFIX:$suffix, TF_RESOURCE_GROUP_ID:$resource_group_id
}'
