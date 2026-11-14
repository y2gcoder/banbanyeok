#!/usr/bin/env bash
# Run one CLI process over changed files, including build-logic and root scripts.
set -euo pipefail
(( $# )) || exit 0
printf -v lint_files '%s,' "$@"
./gradlew ktlintStaged "-PstagedKotlinFiles=${lint_files%,}" --quiet
