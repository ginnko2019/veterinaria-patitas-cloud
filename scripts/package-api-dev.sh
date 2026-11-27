#!/usr/bin/env bash
set -euo pipefail

# Solo contenido de ejecucion: nunca empaquetar local.settings.json, fuentes o tests.
[[ $# == 1 ]] || { echo 'Uso: package-api-dev.sh /ruta/absoluta/patitas-api.zip' >&2; exit 1; }
[[ $1 == /* && $1 == *.zip ]] || { echo 'El destino debe ser una ruta absoluta .zip.' >&2; exit 1; }
[[ ! -e $1 ]] || { echo 'El ZIP de destino ya existe; no se reemplaza.' >&2; exit 1; }
patitas_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
patitas_stage="$(mktemp -d)"
trap 'rm -rf -- "$patitas_stage"' EXIT
test -f "$patitas_root/apps/api/dist/src/functions/health.js"
cp "$patitas_root/apps/api/host.json" "$patitas_root/apps/api/package.json" \
  "$patitas_root/apps/api/package-lock.json" "$patitas_stage/"
cp -R "$patitas_root/apps/api/dist" "$patitas_stage/dist"
npm ci --omit=dev --prefix "$patitas_stage"
(cd "$patitas_stage" && zip -q -r "$1" host.json package.json package-lock.json dist node_modules)
printf 'Paquete de ejecucion creado.\n'
