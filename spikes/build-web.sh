#!/bin/sh
set -eu
cd "$(dirname "$0")"
./bootstrap-gradle.sh
(cd kotlin-js && ../.tools/gradle-9.3.1/bin/gradle jsNodeProductionLibraryDistribution --console=plain)
./prepare-fonts.sh
mkdir -p web/out
(cd web && npm pack ../kotlin-js/build/dist/js/productionLibrary --pack-destination out && npm ci --min-release-age=0)
(cd web && npm run cf:build)
