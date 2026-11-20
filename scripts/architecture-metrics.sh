#!/usr/bin/env bash
# 아키텍처 지표를 모아 GitHub 이슈 본문(마크다운)을 만든다. LLM 없이 숫자만 센다.
# 2주마다 .github/workflows/architecture-metrics.yml이 부르고, 로컬에서도 같은 명령으로 돈다.
#
#   bash scripts/architecture-metrics.sh [--out DIR] [--previous FILE]
#
#   --out DIR        산출물 디렉토리(기본 build/architecture-metrics). body.md가 이슈 본문, snapshot.json이 이번 측정값이다.
#   --previous FILE  지난 이슈 본문. 안에 숨겨 둔 상태 JSON에서 지난 값과 이력을 읽는다. 없으면 첫 측정으로 본다.
#
# 지표 하나가 실패해도 나머지는 계속하고, 그 칸에 "측정 실패"를 쓴다. 이 스크립트는 본문을 만들면 0으로 끝난다.
# 필요한 도구: bash 3.2 이상, git, jq, awk. 서버 지표는 ./gradlew(JDK), 웹 지표는 pnpm이 더 필요하다.
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

OUT="build/architecture-metrics"
PREVIOUS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --previous) PREVIOUS="$2"; shift 2 ;;
    -h | --help) sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"

HOTSPOT_DAYS=30
TOP_FILES=15
TOP_FUNCTIONS=10
KEEP_HISTORY=3

# 코드 파일만 센다. 생성 파일(*.gen.*), 테스트 픽스처, data/, contracts/(계약 JSON·golden), spikes/(버리는 실험)는 뺀다.
CODE_EXT='\.(kt|kts|ts|tsx|js|mjs|cjs|py|sh|sql)$'
EXCLUDE='(^|/)(data|contracts|spikes|build|node_modules)/|\.gen\.[^/]*$|(^|/)([Tt]est)?[Ff]ixtures?/|(^|/|-)[Ff]ixtures?\.[a-z]+$|[a-z]Fixtures?\.[a-z]+$|\.d\.ts$'

code_files() {
  git -c core.quotepath=off ls-files | grep -E "$CODE_EXT" | grep -Ev "$EXCLUDE"
}

line_count() {
  wc -l < "$1" | tr -d ' '
}

# 최근 30일 파일별 변경 횟수 x 줄 수 상위 15.
measure_hotspots() {
  local c f
  git -c core.quotepath=off log --since="${HOTSPOT_DAYS} days ago" --no-merges --name-only --pretty=format: \
    | grep -E "$CODE_EXT" | grep -Ev "$EXCLUDE" | sort | uniq -c \
    | awk '{c=$1; $1=""; sub(/^ /,""); print c "\t" $0}' \
    | while IFS=$'\t' read -r c f; do
      [ -f "$f" ] || continue
      printf '%s\t%s\t%s\n' "$c" "$(line_count "$f")" "$f"
    done \
    | jq -Rn --argjson top "$TOP_FILES" '
        [inputs | split("\t") | {file: .[2], changes: (.[0] | tonumber), lines: (.[1] | tonumber)} | .score = .changes * .lines]
        | sort_by(-.score, .file) | .[0:$top]'
}

# 줄 수 상위 15(코드만).
measure_big_files() {
  local f
  code_files | while IFS= read -r f; do
    printf '%s\t%s\n' "$(line_count "$f")" "$f"
  done \
    | jq -Rn --argjson top "$TOP_FILES" '
        [inputs | split("\t") | {file: .[1], lines: (.[0] | tonumber)}] | sort_by(-.lines, .file) | .[0:$top]'
}

# detekt 보고서(SARIF)에서 복잡도 경고를 센다. CI 기준(config/detekt/detekt.yml)은 경고가 0건이라 순위가 안 나오므로
# -PdetektMetrics=true로 낮춘 기준(config/detekt/metrics.yml)을 겹쳐 돌린다. 이 설정은 실패를 무시한다.
measure_detekt() {
  local reports
  find server shared pipeline -path '*/build/reports/detekt/main*.sarif' -delete 2> /dev/null
  ./gradlew detekt -PdetektMetrics=true --continue --console=plain > "$OUT/detekt.log" 2>&1 || {
    tail -15 "$OUT/detekt.log" >&2
    return 1
  }
  reports="$(find server shared pipeline -path '*/build/reports/detekt/main*.sarif')"
  [ -n "$reports" ] || { echo "detekt SARIF 보고서가 없다" >&2; return 1; }
  # shellcheck disable=SC2086
  jq -s --argjson top "$TOP_FUNCTIONS" '
    def num: (capture("\\((complexity: )?(?<v>[0-9]+)\\)") | .v | tonumber) // 0;
    [.[].runs[0].results[] | select(.ruleId | startswith("detekt.complexity."))
      | {rule: (.ruleId | sub("detekt.complexity."; "")),
         file: .locations[0].physicalLocation.artifactLocation.uri,
         line: .locations[0].physicalLocation.region.startLine,
         fn: (.message.text | capture("function (?<n>[^ ]+)") | .n),
         value: (.message.text | num)}] as $all
    | {count: ($all | length),
       byRule: ($all | group_by(.rule) | map({key: .[0].rule, value: length}) | from_entries),
       top: ($all | group_by([.file, .fn])
         | map({fn: .[0].fn, file: .[0].file, line: .[0].line,
                cyclomatic: (map(select(.rule == "CyclomaticComplexMethod").value) | max // 0),
                cognitive: (map(select(.rule == "CognitiveComplexMethod").value) | max // 0),
                length: (map(select(.rule == "LongMethod").value) | max // 0)})
         | sort_by(-.cyclomatic, -.cognitive, -.length, .file) | .[0:$top])}' $reports
}

# dependency-cruiser: 순환 수, 규칙 위반 수, 팬아웃(로컬 모듈로 나가는 import 수) 상위 10. 팬아웃 순위에서는 *.test.ts(x)를 뺀다.
measure_web() {
  command -v pnpm > /dev/null || { echo "pnpm이 없다" >&2; return 1; }
  if [ ! -d web/node_modules ]; then
    pnpm install --frozen-lockfile > "$OUT/pnpm-install.log" 2>&1 || { tail -15 "$OUT/pnpm-install.log" >&2; return 1; }
  fi
  # 규칙 위반(error)이 있으면 depcruise는 0이 아닌 코드로 끝난다. 보고서가 JSON이면 그대로 쓴다.
  (cd web && pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type json) > "$OUT/depcruise.json" 2> "$OUT/depcruise.err"
  jq -e '.summary and .modules' "$OUT/depcruise.json" > /dev/null || { tail -15 "$OUT/depcruise.err" >&2; return 1; }
  jq --argjson top "$TOP_FUNCTIONS" '
    [.summary.violations[]] as $v
    | {cycles: ($v | map(select(.rule.name == "no-circular")) | length),
       cycleList: ($v | map(select(.rule.name == "no-circular") | (.cycle // []) | map(.name) | join(" -> ")) | .[0:5]),
       violations: ($v | map(select(.rule.name != "no-circular")) | length),
       byRule: ($v | map(select(.rule.name != "no-circular")) | group_by(.rule.name) | map({key: .[0].rule.name, value: length}) | from_entries),
       modules: ([.modules[] | select(.source | startswith("src/"))] | length),
       fanout: ([.modules[] | select(.source | startswith("src/")) | select(.source | test("\\.test\\.tsx?$") | not)
                 | {module: .source, fanout: ([.dependencies[] | select(.dependencyTypes | index("local")) | .resolved] | unique | length)}]
                | sort_by(-.fanout, .module) | .[0:$top])}' "$OUT/depcruise.json"
}

# settings.gradle.kts의 모듈과 각 build.gradle.kts의 project(...) 의존. test*로 시작하는 구성(testFixtures 포함)은 테스트 의존이다.
measure_modules() {
  local mods m dir
  mods="$(grep -v '^[[:space:]]*//' settings.gradle.kts | grep -o '":[A-Za-z0-9:_-]*"' | tr -d '"' | sort -u)"
  [ -n "$mods" ] || { echo "settings.gradle.kts에서 모듈을 못 찾았다" >&2; return 1; }
  for m in $mods; do
    dir="$(printf '%s' "${m#:}" | tr ':' '/')"
    [ -f "$dir/build.gradle.kts" ] || { echo "$dir/build.gradle.kts가 없다" >&2; return 1; }
    awk -v mod="$m" '
      /project\("/ {
        kind = ($0 ~ /^[ \t]*"?(test|integrationTest)/) ? "test" : "main"
        s = $0
        while (match(s, /project\("[^"]+"\)/)) {
          print mod "\t" kind "\t" substr(s, RSTART + 9, RLENGTH - 11)
          s = substr(s, RSTART + RLENGTH)
        }
      }
      END { print mod "\tmodule\t" }' "$dir/build.gradle.kts"
  done | jq -Rn '
    [inputs | split("\t") | {module: .[0], kind: .[1], target: .[2]}]
    | group_by(.module)
    | map({name: .[0].module,
           deps: (map(select(.kind == "main") | .target) | unique),
           testDeps: (map(select(.kind == "test") | .target) | unique)})'
}

# Konsist 아키텍처 테스트. 테스트가 실패한 것은 "측정 실패"가 아니라 위반이다. 테스트가 돌지 못했을 때만 측정 실패다.
measure_konsist() {
  local results="architecture/build/test-results/test" tests failures status=0
  rm -rf "$results"
  ./gradlew :architecture:test --console=plain > "$OUT/konsist.log" 2>&1 || status=$?
  ls "$results"/*.xml > /dev/null 2>&1 || { tail -15 "$OUT/konsist.log" >&2; return 1; }
  tests="$(grep -ho '<testsuite [^>]*' "$results"/*.xml | grep -o ' tests="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
  failures="$(grep -ho '<testsuite [^>]*' "$results"/*.xml | grep -o ' \(failures\|errors\)="[0-9]*"' | grep -o '[0-9]*' | awk '{s+=$1} END {print s+0}')"
  if [ "$status" -eq 0 ] && [ "$failures" -eq 0 ]; then
    jq -n --argjson t "$tests" '{status: "pass", tests: $t, failures: 0}'
  elif [ "$failures" -gt 0 ]; then
    jq -n --argjson t "$tests" --argjson f "$failures" '{status: "fail", tests: $t, failures: $f}'
  else
    tail -15 "$OUT/konsist.log" >&2
    return 1
  fi
}

# 지표 하나를 돌려 JSON을 $OUT/<이름>.json에 쓴다. 실패하면 null을 쓰고 다음으로 간다.
run_measure() {
  local name="$1"
  shift
  if "$@" > "$OUT/$name.json.tmp" 2> "$OUT/$name.err" && jq -e . "$OUT/$name.json.tmp" > /dev/null 2>&1; then
    mv "$OUT/$name.json.tmp" "$OUT/$name.json"
    echo "측정 완료: $name" >&2
  else
    echo "측정 실패: $name" >&2
    tail -5 "$OUT/$name.err" >&2
    echo null > "$OUT/$name.json"
    rm -f "$OUT/$name.json.tmp"
  fi
}

# 지난 이슈 본문에 숨겨 둔 상태 JSON을 꺼낸다. 없거나 깨졌으면 빈 상태를 돌려준다.
read_state() {
  local empty='{"current":null,"history":[]}' state=""
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS" ]; then
    state="$(awk '/^<!-- architecture-metrics-state/ {f = 1; next} f && /^-->/ {f = 0} f' "$PREVIOUS")"
  fi
  if [ -n "$state" ] && printf '%s' "$state" | jq -e '(.history | type) == "array"' > /dev/null 2>&1; then
    printf '%s' "$state" | jq -c .
  else
    echo "$empty"
  fi
}

# 직전 대비 변화가 큰 항목을 한 줄씩 뽑는다. 입력은 {cur, prev, failed}. prev는 지표별로 가장 최근의 성공한 값이다.
# 기준: 큰 파일 +-50줄 또는 +20%(20줄 이상), 팬아웃 +-3, detekt 경고 +-3건, 순환·규칙 위반 수 변화, Konsist 실패, 모듈 의존 추가·삭제.
# shellcheck disable=SC2016
CHANGES_JQ='
def names: {hotspots: "핫스팟", bigFiles: "큰 파일", detekt: "서버 복잡도", web: "웹 의존", modules: "서버 모듈 의존", konsist: "Konsist 아키텍처 테스트"};
def sign: if . > 0 then "+\(.)" else "\(.)" end;
.cur as $c | .prev as $p |
[ (["hotspots", "bigFiles", "detekt", "web", "modules", "konsist"][] as $k | select($c[$k] == null) | "측정 실패: \(names[$k]). 워크플로 실행 로그를 확인하세요."),
  (if $c.bigFiles != null and $p.bigFiles != null then
     $c.bigFiles[] as $f | ($p.bigFiles | map(select(.file == $f.file)) | .[0]) as $o
     | if $o == null then "큰 파일 상위 \(($c.bigFiles | length))에 새로 진입: `\($f.file)` (\($f.lines)줄)"
       else ($f.lines - $o.lines) as $d
         | select(($d >= 50) or ($d <= -50) or ($d >= 20 and $d * 5 >= $o.lines))
         | "큰 파일 `\($f.file)`: \($o.lines)줄 -> \($f.lines)줄 (\($d | sign))" end
   else empty end),
  (if $c.hotspots != null and $p.hotspots != null and ($c.hotspots | length) > 0 then
     (if ($p.hotspots | length) > 0 and $c.hotspots[0].file != $p.hotspots[0].file
      then "핫스팟 1위가 `\($p.hotspots[0].file)`에서 `\($c.hotspots[0].file)`로 바뀜" else empty end),
     ($c.hotspots[0:5][] | select(.file as $f | ($p.hotspots[0:5] | map(.file) | index($f)) == null)
      | "핫스팟 상위 5에 새로 진입: `\(.file)` (변경 \(.changes)회 x \(.lines)줄)")
   else empty end),
  (if $c.detekt != null and $p.detekt != null then
     ($c.detekt.count - $p.detekt.count) as $d
     | (select($d >= 3 or $d <= -3) | "복잡도 경고 \($p.detekt.count)건 -> \($c.detekt.count)건 (\($d | sign))"),
     (if ($c.detekt.top | length) > 0 and ($p.detekt.top | length) > 0 and $c.detekt.top[0].cyclomatic > $p.detekt.top[0].cyclomatic
      then "최고 순환 복잡도 \($p.detekt.top[0].cyclomatic) -> \($c.detekt.top[0].cyclomatic) (`\($c.detekt.top[0].fn)`)" else empty end)
   else empty end),
  (if $c.web != null and $p.web != null then
     (if $c.web.cycles != $p.web.cycles then "웹 순환 의존 \($p.web.cycles)건 -> \($c.web.cycles)건" else empty end),
     (if $c.web.violations != $p.web.violations then "웹 규칙 위반 \($p.web.violations)건 -> \($c.web.violations)건" else empty end),
     ($c.web.fanout[] as $f | ($p.web.fanout | map(select(.module == $f.module)) | .[0]) as $o
      | select($o != null and (($f.fanout - $o.fanout) >= 3 or ($f.fanout - $o.fanout) <= -3))
      | "웹 팬아웃 `\($f.module)`: \($o.fanout) -> \($f.fanout)")
   else empty end),
  (if $c.konsist != null and $c.konsist.status == "fail" then "Konsist 아키텍처 테스트 실패 \($c.konsist.failures)건" else empty end),
  (if $c.modules != null and $p.modules != null then
     ($c.modules[] as $m | ($p.modules | map(select(.name == $m.name)) | .[0]) as $o
     | if $o == null then "서버 모듈 추가: `\($m.name)`"
       else (($m.deps - $o.deps) | map("`\(.)` 추가") + (($o.deps - $m.deps) | map("`\(.)` 삭제"))) as $diff
         | select($diff | length > 0) | "모듈 `\($m.name)` 의존: \($diff | join(", "))" end),
     ($p.modules[] | select(.name as $n | ($c.modules | map(.name) | index($n)) == null) | "서버 모듈 삭제: `\(.name)`")
   else empty end)
] | map("- " + .) | .[]'

render_hotspots() {
  jq -r '
    if . == null then "측정 실패" else
    "| 순위 | 파일 | 변경 | 줄 | 점수 |", "|---:|---|---:|---:|---:|",
    (to_entries[] | "| \(.key + 1) | `\(.value.file)` | \(.value.changes) | \(.value.lines) | \(.value.score) |") end' "$OUT/hotspots.json"
}

render_big_files() {
  jq -r --slurpfile prev "$OUT/prev-sections.json" '
    ($prev[0].bigFiles // null) as $p
    | if . == null then "측정 실패" else
    "| 순위 | 파일 | 줄 | 직전 대비 |", "|---:|---|---:|---|",
    (to_entries[] | .key as $i | .value as $f
      | ($p | if . == null then null else (map(select(.file == $f.file)) | .[0]) end) as $o
      | "| \($i + 1) | `\($f.file)` | \($f.lines) | "
        + (if $p == null then "-" elif $o == null then "신규 진입" elif $f.lines == $o.lines then "변화 없음"
           else ($f.lines - $o.lines | if . > 0 then "+\(.)" else "\(.)" end) end) + " |") end' "$OUT/bigfiles.json"
}

render_detekt() {
  jq -r '
    if . == null then "측정 실패" else
    "복잡도 경고 **\(.count)건** (순환 \(.byRule.CyclomaticComplexMethod // 0) · 인지 \(.byRule.CognitiveComplexMethod // 0) · 긴 메서드 \(.byRule.LongMethod // 0))",
    "",
    "| 순위 | 함수 | 위치 | 순환 | 인지 | 줄 |", "|---:|---|---|---:|---:|---:|",
    (.top | to_entries[] | .value as $f
      | "| \(.key + 1) | `\($f.fn)` | `\($f.file):\($f.line)` | \(if $f.cyclomatic > 0 then $f.cyclomatic else "-" end) | \(if $f.cognitive > 0 then $f.cognitive else "-" end) | \(if $f.length > 0 then $f.length else "-" end) |") end' "$OUT/detekt.json"
}

render_web() {
  jq -r '
    if . == null then "측정 실패" else
    "순환 의존 **\(.cycles)건** · 규칙 위반 **\(.violations)건** · 분석한 모듈 \(.modules)개",
    (if .cycles > 0 then "", (.cycleList[] | "- 순환: `\(.)`") else empty end),
    (if .violations > 0 then "", (.byRule | to_entries[] | "- 위반 규칙 `\(.key)`: \(.value)건") else empty end),
    "",
    "| 순위 | 모듈 | 팬아웃 |", "|---:|---|---:|",
    (.fanout | to_entries[] | "| \(.key + 1) | `\(.value.module)` | \(.value.fanout) |") end' "$OUT/web.json"
}

render_modules() {
  jq -r '
    if . == null then "측정 실패" else
    "| 모듈 | project 의존 | 테스트 의존 |", "|---|---|---|",
    (.[] | "| `\(.name)` | \(if (.deps | length) == 0 then "-" else (.deps | map("`\(.)`") | join(", ")) end) | \(if (.testDeps | length) == 0 then "-" else (.testDeps | map("`\(.)`") | join(", ")) end) |") end' "$OUT/modules.json"
}

render_konsist() {
  jq -r '
    if . == null then "측정 실패"
    elif .status == "pass" then "통과 (테스트 \(.tests)개)"
    else "**실패** (\(.tests)개 중 \(.failures)개)" end' "$OUT/konsist.json"
}

# 이력 표의 한 줄. 입력은 스냅샷 하나.
render_history() {
  jq -r '
    def cell(f): if f == null then "측정 실패" else f end;
    if length == 0 then "기록 없음" else
    "| 날짜 | 기준 커밋 | 큰 파일 1위 | 핫스팟 1위 | 복잡도 경고 | 웹 순환 | 웹 규칙 위반 | Konsist |", "|---|---|---|---|---:|---:|---:|---|",
    (.[] | "| \(.date) | `\(.sha)` | \(cell(.bigFiles | if . == null then null else "`\(.[0].file)` \(.[0].lines)줄" end)) | \(cell(.hotspots | if . == null then null elif length == 0 then "-" else "`\(.[0].file)`" end)) | \(cell(.detekt.count)) | \(cell(.web.cycles)) | \(cell(.web.violations)) | \(cell(.konsist | if . == null then null elif .status == "pass" then "통과" else "실패 \(.failures)건" end)) |") end'
}

main() {
  local state prev_date now_date week sha run_url="" changes history_json

  run_measure hotspots measure_hotspots
  run_measure bigfiles measure_big_files
  run_measure detekt measure_detekt
  run_measure web measure_web
  run_measure modules measure_modules
  run_measure konsist measure_konsist

  now_date="$(TZ=Asia/Seoul date +%Y-%m-%d)"
  week="$(TZ=Asia/Seoul date +%G-W%V)"
  sha="$(git rev-parse --short=7 HEAD 2> /dev/null || echo unknown)"
  if [ -n "${GITHUB_RUN_ID:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
  fi

  jq -n --arg date "$now_date" --arg week "$week" --arg sha "$sha" \
    --slurpfile hs "$OUT/hotspots.json" --slurpfile bf "$OUT/bigfiles.json" --slurpfile dt "$OUT/detekt.json" \
    --slurpfile wb "$OUT/web.json" --slurpfile md "$OUT/modules.json" --slurpfile ks "$OUT/konsist.json" \
    '{date: $date, week: $week, sha: $sha, hotspots: $hs[0], bigFiles: $bf[0], detekt: $dt[0], web: $wb[0], modules: $md[0], konsist: $ks[0]}' \
    > "$OUT/snapshot.json" || return 1

  state="$(read_state)"
  prev_date="$(printf '%s' "$state" | jq -r '.current.date // empty')"
  # 지표별로 가장 최근에 성공한 지난 값. 한 번 실패해도 다음 실행이 그 전 값과 비교할 수 있다.
  printf '%s' "$state" | jq -c '
    ([.current] + .history | map(select(. != null))) as $s
    | reduce ("hotspots", "bigFiles", "detekt", "web", "modules", "konsist") as $k ({}; .[$k] = ([$s[] | .[$k] | select(. != null)] | first // null))' \
    > "$OUT/prev-sections.json"

  jq -c -n --slurpfile cur "$OUT/snapshot.json" --slurpfile prev "$OUT/prev-sections.json" '{cur: $cur[0], prev: $prev[0]}' \
    | jq -r "$CHANGES_JQ" > "$OUT/changes.md"
  changes="$(cat "$OUT/changes.md")"

  history_json="$(printf '%s' "$state" | jq -c --argjson keep "$KEEP_HISTORY" '([.current] + .history | map(select(. != null))) | .[0:$keep]')"

  {
    echo "이 이슈는 2주마다 자동으로 갱신됩니다. 리팩터링 후보는 코디네이터가 이 지표를 보고 따로 이슈로 만듭니다."
    echo
    # shellcheck disable=SC2016
    printf '> 측정일 %s (%s), 기준 커밋 `%s`.' "$now_date" "$week" "$sha"
    if [ -n "$prev_date" ]; then printf ' 직전 측정 %s.' "$prev_date"; fi
    if [ -n "$run_url" ]; then printf ' [실행 로그](%s)' "$run_url"; fi
    echo
    echo
    echo "## 직전 대비 변화"
    echo
    if [ -z "$prev_date" ]; then
      echo "첫 측정입니다. 비교할 직전 값이 없습니다."
      [ -z "$changes" ] || { echo; echo "$changes"; }
    elif [ -n "$changes" ]; then
      echo "$changes"
    else
      echo "큰 변화 없음."
    fi
    echo
    echo "## 1. 핫스팟 (최근 ${HOTSPOT_DAYS}일 변경 횟수 x 줄 수, 상위 ${TOP_FILES})"
    echo
    echo "코드 파일만 센다. 생성 파일(\`*.gen.*\`), 테스트 픽스처, \`data/\`, \`contracts/\`, \`spikes/\`는 뺀다. 점수가 클수록 자주 바뀌는 큰 파일이다."
    echo
    render_hotspots
    echo
    echo "## 2. 큰 파일 (줄 수 상위 ${TOP_FILES})"
    echo
    echo "같은 제외 규칙의 코드 파일 기준이다. 직전 대비는 직전 상위 ${TOP_FILES}에 있던 파일만 비교한다."
    echo
    render_big_files
    echo
    echo "## 3. 서버 복잡도 (detekt)"
    echo
    echo "server·shared·pipeline의 main 소스만 본다. CI 기준(\`config/detekt/detekt.yml\`)은 통과 상태라 경고가 0건이어서, 순위를 보이도록 낮춘 관찰 기준(\`config/detekt/metrics.yml\`)으로 센다."
    echo
    render_detekt
    echo
    echo "## 4. 웹 의존 (dependency-cruiser)"
    echo
    echo "\`web/src\`를 \`web/.dependency-cruiser.cjs\` 규칙으로 검사한다. 팬아웃은 한 모듈이 import하는 \`src\` 안의 다른 모듈 수이고, 테스트 파일은 순위에서 뺀다."
    echo
    render_web
    echo
    echo "## 5. 서버 모듈 의존"
    echo
    echo "\`settings.gradle.kts\`의 모듈과 각 \`build.gradle.kts\`의 \`project(...)\` 의존이다."
    echo
    render_modules
    echo
    # shellcheck disable=SC2016
    printf 'Konsist 아키텍처 테스트(`./gradlew :architecture:test`): '
    render_konsist
    echo
    echo "<details>"
    echo "<summary>이력 (직전 ${KEEP_HISTORY}회)</summary>"
    echo
    printf '%s' "$history_json" | render_history
    echo
    echo "</details>"
    echo
    echo "측정 방법은 \`scripts/architecture-metrics.sh\`에 있고 로컬에서도 \`bash scripts/architecture-metrics.sh\`로 돈다. 아래 숨은 블록은 다음 실행이 비교에 쓰는 값이다. 지우지 마세요."
    echo
    echo "<!-- architecture-metrics-state"
    # "-->"가 본문 중간에서 주석을 닫지 않도록 '>'를 이스케이프한다(JSON 문자열 안에서만 나온다).
    jq -c -n --slurpfile cur "$OUT/snapshot.json" --argjson hist "$history_json" '{version: 1, current: $cur[0], history: $hist}' | sed 's/>/\\u003e/g'
    echo "-->"
  } > "$OUT/body.md"

  echo "이슈 본문: $OUT/body.md ($(wc -c < "$OUT/body.md" | tr -d ' ')바이트)" >&2
}

main
