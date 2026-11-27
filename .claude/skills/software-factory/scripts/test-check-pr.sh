#!/usr/bin/env bash
set -euo pipefail

gate="$(cd "$(dirname "$0")" && pwd)/check-pr.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
export PATH="$fixture:$PATH"
export FACTORY_FIXTURE="$fixture"
export REVIEWED_SHA=1111111111111111111111111111111111111111
export NEW_SHA=2222222222222222222222222222222222222222

cat > "$fixture/gh" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == pr && "$3" == 42 && "$4" == --repo && "$5" == y2gcoder/banbanyeok ]]
case "$2" in
  view)
    head="$REVIEWED_SHA"
    if [[ "$SCENARIO" == stale-after-ci && -e "$FACTORY_FIXTURE/checked" ]]; then head="$NEW_SHA"; fi
    if [[ "$SCENARIO" == stale ]]; then head="$NEW_SHA"; fi
    draft=false
    if [[ "$SCENARIO" == draft ]]; then draft=true; fi
    printf '{"state":"OPEN","baseRefName":"main","headRefOid":"%s","isDraft":%s}\n' "$head" "$draft"
    ;;
  checks)
    [[ "$6" == --required ]]
    touch "$FACTORY_FIXTURE/checked"
    case "$SCENARIO" in
      unavailable) exit 1 ;;
      pending) printf '[{"name":"ci-ok","state":"IN_PROGRESS"},{"name":"gitleaks","state":"SUCCESS"}]\n'; exit 8 ;;
      extra-failed) printf '[{"name":"ci-ok","state":"SUCCESS"},{"name":"gitleaks","state":"SUCCESS"},{"name":"another required check","state":"FAILURE"}]\n' ;;
      skipped) printf '[{"name":"ci-ok","state":"SKIPPED"},{"name":"gitleaks","state":"SUCCESS"}]\n' ;;
      missing) printf '[{"name":"gitleaks","state":"SUCCESS"}]\n' ;;
      *) printf '[{"name":"ci-ok","state":"SUCCESS"},{"name":"gitleaks","state":"SUCCESS"}]\n' ;;
    esac
    ;;
  *) exit 99 ;;
esac
MOCK
chmod +x "$fixture/gh"

expect_result() {
  local scenario="$1" expected_status="$2" expected_text="$3"
  local status=0 output
  rm -f "$fixture/checked"
  output="$(SCENARIO="$scenario" bash "$gate" 42 "$REVIEWED_SHA" 2>&1)" || status=$?
  if [[ "$status" != "$expected_status" || "$output" != *"$expected_text"* ]]; then
    printf '%s: expected exit %s and %s, got exit %s and %s\n' \
      "$scenario" "$expected_status" "$expected_text" "$status" "$output" >&2
    exit 1
  fi
}

expect_result pass 0 "$REVIEWED_SHA"
expect_result stale 1 "PR head differs"
expect_result stale-after-ci 1 "PR changed while checks were read"
expect_result draft 1 "open, non-draft PR targeting main"
expect_result pending 1 "Required GitHub checks have not passed"
expect_result skipped 1 "ci-ok and gitleaks must both report SUCCESS"
expect_result missing 1 "ci-ok and gitleaks must both report SUCCESS"
expect_result extra-failed 1 "Required GitHub checks have not passed"
expect_result unavailable 1 "Could not read required GitHub checks"
printf 'OK (9 PR gate cases)\n'
