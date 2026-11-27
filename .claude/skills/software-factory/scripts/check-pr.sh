#!/usr/bin/env bash
set -euo pipefail

repo=y2gcoder/banbanyeok

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "$#" != 2 || ! "$1" =~ ^[1-9][0-9]*$ || ! "$2" =~ ^[0-9a-f]{40}$ ]]; then
  fail "Usage: bash check-pr.sh <PR number> <reviewed 40-character commit SHA>"
fi
pr="$1"
reviewed_sha="$2"

pr_snapshot() {
  gh pr view "$pr" --repo "$repo" --json state,isDraft,baseRefName,headRefOid | jq -cS .
}

before="$(pr_snapshot)" || fail "Could not read PR state"
jq -e '.state == "OPEN" and .isDraft == false and .baseRefName == "main"' <<<"$before" >/dev/null ||
  fail "Expected an open, non-draft PR targeting main"
jq -e --arg sha "$reviewed_sha" '.headRefOid == $sha' <<<"$before" >/dev/null ||
  fail "PR head differs from the reviewed commit"

check_status=0
checks="$(gh pr checks "$pr" --repo "$repo" --required --json name,state)" || check_status=$?
if [[ -z "$checks" ]] || ! jq -e 'type == "array" and all(.[]; (.state | type) == "string")' <<<"$checks" >/dev/null; then
  fail "Could not read required GitHub checks"
fi
if [[ "$check_status" != 0 ]]; then
  jq -r '.[] | "\(.name) \(.state)"' <<<"$checks" >&2
  fail "Required GitHub checks have not passed"
fi

jq -e '
  def successful($check):
    map(select(.name == $check)) | length > 0 and all(.state == "SUCCESS");
  successful("ci-ok") and successful("gitleaks")
' <<<"$checks" >/dev/null || fail "ci-ok and gitleaks must both report SUCCESS"
if ! jq -e 'all(.[]; .state == "SUCCESS" or .state == "SKIPPED" or .state == "NEUTRAL")' <<<"$checks" >/dev/null; then
  jq -r '.[] | "\(.name) \(.state)"' <<<"$checks" >&2
  fail "Required GitHub checks have not passed"
fi

after="$(pr_snapshot)" || fail "Could not re-read PR state"
[[ "$before" == "$after" ]] || fail "PR changed while checks were read"
printf 'Required CI passed for #%s at %s\n' "$pr" "$reviewed_sha"
