#!/usr/bin/env bash
set -euo pipefail

# Diagnostico ARM de solo lectura: no cambia contexto, recursos, cuotas ni providers.
# Web: https://learn.microsoft.com/rest/api/appservice/get-usages-in-location/list?view=rest-appservice-2026-03-15
# SQL: https://learn.microsoft.com/rest/api/sql/capabilities/list-by-location?view=rest-sql-2025-01-01
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  printf '%s\n' 'Uso: check-azure-dev-capacity.sh --subscription-id GUID [--regions eastus2,eastus,centralus,southcentralus]'
  printf '%s\n' 'Salidas: 0 consultas completas; 1 error de consulta; 2 cuota Y1 no expuesta o inventario incompleto.'
}
subscription_id=
regions_csv=eastus2,eastus,centralus,southcentralus
while (($#)); do
  [[ "$1" != --help ]] || { usage; exit 0; }
  (($# >= 2)) || fail "Falta el valor de $1."
  case "$1" in
    --subscription-id) subscription_id=$2 ;;
    --regions) regions_csv=$2 ;;
    *) fail "Parametro desconocido: $1" ;;
  esac
  shift 2
done
[[ $subscription_id =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || fail 'subscription-id requiere un GUID.'
[[ $regions_csv =~ ^[a-z0-9]+(,[a-z0-9]+)*$ ]] || fail 'regions requiere nombres cortos separados por comas, sin espacios.'
command -v az >/dev/null || fail 'Azure CLI no esta disponible; ejecutar en Cloud Shell con sesion iniciada.'
command -v jq >/dev/null || fail 'jq no esta disponible.'
subscription_id=${subscription_id,,}
IFS=, read -r -a regions <<<"$regions_csv"
base="https://management.azure.com/subscriptions/$subscription_id"
runtime_rg=rg-patitas-dev
failures=0
incomplete=0
response=

# Esta es la unica llamada a Azure CLI del script. Todas las URLs incluyen la
# suscripcion explicita y todos los metodos son GET; nunca se imprimen tokens.
arm_get() {
  local url=$1
  if ! response="$(az rest --method get --url "$url" --subscription "$subscription_id" --only-show-errors --output json)"; then
    printf 'ERROR: no se pudo consultar %s; se continua con las demas consultas.\n' "$url" >&2
    failures=$((failures + 1))
    return 1
  fi
  if ! jq -e 'type == "object" and (has("error") | not)' <<<"$response" >/dev/null; then
    printf 'ERROR: respuesta JSON inesperada de %s.\n' "$url" >&2
    failures=$((failures + 1))
    return 1
  fi
}

show() {
  local title=$1 url=$2 filter=$3
  printf '\n### %s\n' "$title"
  if ! arm_get "$url"; then return 1; fi
  if ! jq "$filter" <<<"$response"; then
    printf 'ERROR: estructura inesperada en %s.\n' "$title" >&2
    failures=$((failures + 1))
    return 1
  fi
}

printf '%s\n' 'Diagnostico de solo lectura. Available o cuota positiva no garantizan capacidad actual de aprovisionamiento.'
show 'Suscripcion (comprobar tenantId y state)' "$base?api-version=2022-12-01" \
  '{subscriptionId, displayName, tenantId, state}' || true

for namespace in Microsoft.Storage Microsoft.Web Microsoft.Insights Microsoft.OperationalInsights Microsoft.Sql; do
  show "Provider $namespace" "$base/providers/$namespace?api-version=2021-04-01" \
    '{namespace, registrationState}' || true
done

if show "Recursos parciales en $runtime_rg" \
  "$base/resourceGroups/$runtime_rg/resources?api-version=2021-04-01&\$expand=provisioningState" '
    if (.value | type) != "array" then error("Falta value[]") else
      {resources: [.value[] | {name, type, location, id,
        provisioningState: (.properties.provisioningState // null)}], nextLink}
    end'; then
  if jq -e '.nextLink != null and .nextLink != ""' <<<"$response" >/dev/null; then
    printf '%s\n' 'ERROR DE DIAGNOSTICO: el inventario tiene otra pagina; la ausencia de un recurso no es concluyente.' >&2
    incomplete=1
  fi
fi

# La lista tipada permite ver un posible servidor SQL residual de la creacion fallida.
if show 'Servidores SQL y su estado observado' \
  "$base/resourceGroups/$runtime_rg/providers/Microsoft.Sql/servers?api-version=2025-01-01" '
    if (.value | type) != "array" then error("Falta value[]") else
      {servers: [.value[] | {name, location, id, state: .properties.state,
        provisioningState: (.properties.provisioningState // null),
        fullyQualifiedDomainName: .properties.fullyQualifiedDomainName}], nextLink}
    end'; then
  if jq -e '.nextLink != null and .nextLink != ""' <<<"$response" >/dev/null; then
    printf '%s\n' 'ERROR DE DIAGNOSTICO: la lista SQL tiene otra pagina; no es un inventario completo.' >&2
    incomplete=1
  fi
fi

for region in "${regions[@]}"; do
  if show "Microsoft.Web usages: $region" \
    "$base/providers/Microsoft.Web/locations/$region/usages?api-version=2026-03-15" '
      if (.value | type) != "array" then error("Falta value[]") else
        {usages: [.value[] | {name, currentValue, limit, unit}], nextLink}
      end'; then
    # Los medidores de cores generales no demuestran la cuota de instancias Y1.
    if ! jq -e 'any(.value[];
      ([.name.value, .name.localizedValue] | map(. // "") | join(" "))
      | test("(^|[^a-z0-9])y1([^a-z0-9]|$)"; "i"))' <<<"$response" >/dev/null; then
      printf 'ERROR DE DIAGNOSTICO: %s no expone un medidor Y1 identificable; no se puede confirmar su cuota con esta respuesta.\n' "$region" >&2
      incomplete=1
    fi
    if jq -e '.nextLink != null and .nextLink != ""' <<<"$response" >/dev/null; then
      printf 'ERROR DE DIAGNOSTICO: usages de %s tiene otra pagina; faltan medidores.\n' "$region" >&2
      incomplete=1
    fi
  fi

  show "Microsoft.Sql capabilities (servidor y Basic): $region" \
    "$base/providers/Microsoft.Sql/locations/$region/capabilities?api-version=2025-01-01" '
      {location: .name, status, reason,
       serverVersions: [(.supportedServerVersions // [])[] |
         {version: .name, status, reason,
          basicEditions: [(.supportedEditions // [])[] |
            select((.name | ascii_downcase) == "basic") |
            {name, status, reason,
             serviceObjectives: [(.supportedServiceLevelObjectives // [])[] |
               {name, status, reason, sku}]}]}],
       interpretation: "Basic ausente o status/reason nulos no confirman acceso. Available tampoco garantiza capacidad actual."}
    ' || true
done

printf '\n%s\n' 'Si Y1 no aparece, falta confirmar la cuota especifica Y1 de Microsoft.Web por region en Azure (Quotas/Usage + quotas); si tampoco se expone alli, Microsoft debe confirmar cuota/acceso regional mediante soporte autorizado.'
printf '%s\n' 'Este diagnostico no solicita aumentos, no selecciona una region y no justifica cambiar la ubicacion global de los recursos existentes.'
printf 'Resultado: %s errores de consulta; diagnostico incompleto=%s.\n' "$failures" "$incomplete"
((failures == 0)) || exit 1
((incomplete == 0)) || exit 2
