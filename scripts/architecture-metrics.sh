#!/usr/bin/env bash
# 아키텍처 지표 5개를 모아 GitHub 이슈 본문(마크다운)을 만든다. LLM 없이 숫자만 센다.
# 2주마다 .github/workflows/architecture-metrics.yml이 부르고, 로컬에서도 같은 명령으로 돈다.
# 지표 이름과 계산법은 아키텍처 점검(docs/research/architecture-review-2026-11.md 5절)이 정했다.
#
#   bash scripts/architecture-metrics.sh [--out DIR] [--previous FILE]
#
#   --out DIR        산출물 디렉토리(기본 build/architecture-metrics). body.md가 이슈 본문, snapshot.json이 이번 측정값이다.
#   --previous FILE  지난 이슈 본문. 안에 숨겨 둔 상태 JSON에서 지난 값·최초 기준값·이력을 읽는다. 없으면 첫 측정으로 본다.
#
# 지표 하나가 실패해도 나머지는 계속하고, 그 칸에 "측정 실패"를 쓴다. 이 스크립트는 본문을 만들면 0으로 끝난다.
# 처음 두 회차는 기록만 하고 경보(직전 대비 큰 변화) 요약을 내지 않는다. 그 뒤의 기준값은 잠정이며 CHANGES_JQ 위쪽에 있다.
# 필요한 도구: bash 3.2 이상, git, jq, awk. kotlin 지표는 ./gradlew(JDK), web 지표는 pnpm이 더 필요하다.
# shellcheck disable=SC2016
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

OUT="build/architecture-metrics"
PREVIOUS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --previous) PREVIOUS="$2"; shift 2 ;;
    -h | --help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$OUT"

WINDOW="14.days"
KEEP_HISTORY=3
BASELINE_RUNS=2

# 제품 코드 파일. 테스트·e2e·생성 파일·목·*.cases.ts와 처리방침 본문(코드가 아니라 글)은 뺀다.
PRODUCT_EXT='\.(kt|ts|tsx)$'
HOTSPOT_EXCLUDE='(^|/)(test|commonTest|jvmTest|integrationTest|testFixtures|fixtures|e2e[^/]*)/|(Test\.kt|\.test\.tsx?|\.spec\.tsx?|\.cases\.tsx?)$|\.gen\.[a-z]+$|^web/mock/|^web/src/app/privacy/policy\.ts$'

line_count() {
  wc -l < "$1" | tr -d ' '
}

# hotspot_top10: 제품 코드 파일마다 현재 줄 수 x 최근 14일 git log 등장 횟수. 상위 10.
measure_hotspot_top10() {
  local c f
  git -c core.quotepath=off log --since="$WINDOW" --format= --name-only \
    | grep -E "$PRODUCT_EXT" | grep -Ev "$HOTSPOT_EXCLUDE" | sort | uniq -c \
    | awk '{c=$1; $1=""; sub(/^ /,""); print c "\t" $0}' \
    | while IFS=$'\t' read -r c f; do
      [ -f "$f" ] || continue
      printf '%s\t%s\t%s\n' "$c" "$(line_count "$f")" "$f"
    done \
    | jq -Rn '
        {items: ([inputs | split("\t") | {file: .[2], appearances: (.[0] | tonumber), lines: (.[1] | tonumber)} | .score = .appearances * .lines]
                 | sort_by(-.score, .file) | .[0:10])}'
}

# 지난 회차와 비교해 새로 들어온 파일(isNew)과 3회 연속 상위 5위(streak)를 표시한다. $1은 [직전 스냅샷, ...] JSON.
annotate_hotspot() {
  jq --argjson snaps "$1" '
    def top5($s; $f): $s != null and $s.hotspot_top10 != null
      and ((($s.hotspot_top10.items | map(.file) | index($f)) as $i | $i != null and $i < 5));
    .items |= (to_entries | map(.key as $i | .value as $it
      | $it + {isNew: ($snaps[0] != null and $snaps[0].hotspot_top10 != null
                       and (($snaps[0].hotspot_top10.items | map(.file) | index($it.file)) == null)),
               streak: ($i < 5 and top5($snaps[0]; $it.file) and top5($snaps[1]; $it.file))}))'
}

# kotlin_complex_functions: 임계값을 낮춘 detekt 설정(순환 9, 인지 14)을 init 스크립트로 주입해 ./gradlew detekt를 돌린다.
# 저장소 설정은 고치지 않는다. main 소스의 SARIF에서 순환 복잡도 10 이상, 인지 복잡도 15 이상 함수를 세고,
# 같은 실행의 main 보고서(markdown)에서 모듈별 mcc per 1,000 lloc을 낸다.
measure_kotlin_complex_functions() {
  local reports md mod mcc lloc
  find server shared pipeline -path '*/build/reports/detekt/main*' \( -name '*.sarif' -o -name '*.md' \) -delete 2> /dev/null
  ./gradlew detekt -I scripts/detekt-metrics.init.gradle --continue --console=plain > "$OUT/detekt.log" 2>&1 || {
    tail -15 "$OUT/detekt.log" >&2
    return 1
  }
  reports="$(find server shared pipeline -path '*/build/reports/detekt/main*.sarif' | sort)"
  [ -n "$reports" ] || { echo "detekt SARIF 보고서가 없다" >&2; return 1; }
  for md in $(find server shared pipeline -path '*/build/reports/detekt/main*.md' | sort); do
    mod="${md%%/build/reports/*}"
    mcc="$(sed -n 's/^\* \([0-9,]*\) cyclomatic complexity (mcc).*/\1/p' "$md" | tr -d ',')"
    lloc="$(sed -n 's/^\* \([0-9,]*\) logical lines of code (lloc).*/\1/p' "$md" | tr -d ',')"
    [ -n "$mcc" ] && [ -n "$lloc" ] && printf '%s\t%s\t%s\n' "$mod" "$mcc" "$lloc"
  done | jq -Rn '[inputs | split("\t") | {module: .[0], mcc: (.[1] | tonumber), lloc: (.[2] | tonumber)}
                 | .mccPerKloc = (if .lloc > 0 then (.mcc * 1000 / .lloc | round) else 0 end)]' > "$OUT/kotlin-modules.json"
  # shellcheck disable=SC2086
  jq -s --slurpfile mods "$OUT/kotlin-modules.json" '
    def num: (capture("\\(complexity: (?<v>[0-9]+)\\)") | .v | tonumber) // 0;
    [.[].runs[0].results[]
      | select(.ruleId == "detekt.complexity.CyclomaticComplexMethod" or .ruleId == "detekt.complexity.CognitiveComplexMethod")
      | select(.locations[0].physicalLocation.artifactLocation.uri | test("(^|/)(test|commonTest|jvmTest|integrationTest|testFixtures)/") | not)
      | {rule: (.ruleId | sub("detekt.complexity."; "")),
         file: .locations[0].physicalLocation.artifactLocation.uri,
         line: .locations[0].physicalLocation.region.startLine,
         fn: (.message.text | capture("function (?<n>[^ ]+)") | .n),
         value: (.message.text | num)}] as $all
    | {cyclomatic10: ($all | map(select(.rule == "CyclomaticComplexMethod")) | length),
       cognitive15: ($all | map(select(.rule == "CognitiveComplexMethod")) | length),
       functions: ($all | group_by([.file, .fn])
         | map({fn: .[0].fn, file: .[0].file, line: .[0].line,
                cyclomatic: (map(select(.rule == "CyclomaticComplexMethod").value) | max // 0),
                cognitive: (map(select(.rule == "CognitiveComplexMethod").value) | max // 0)})
         | sort_by(-.cyclomatic, -.cognitive, .file) | .[0:10]),
       modules: $mods[0]}' $reports
}

# web_package_cycles: dependency-cruiser JSON에서 테스트·.cases. 파일을 빼고, 노드를 src/(lib|components)/<dir>로 묶은 그래프의
# 크기 2 이상 강한 연결 요소(SCC)의 개수와 크기 합, 제품 파일의 최대 팬아웃(내부 import 수). 파일 단위 순환·규칙 위반도 곁들인다.
measure_web_package_cycles() {
  command -v pnpm > /dev/null || { echo "pnpm이 없다" >&2; return 1; }
  if [ ! -d web/node_modules ]; then
    pnpm install --frozen-lockfile > "$OUT/pnpm-install.log" 2>&1 || { tail -15 "$OUT/pnpm-install.log" >&2; return 1; }
  fi
  # 규칙 위반(error)이 있으면 depcruise는 0이 아닌 코드로 끝난다. 보고서가 JSON이면 그대로 쓴다.
  (cd web && pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type json) > "$OUT/depcruise.json" 2> "$OUT/depcruise.err"
  jq -e '.summary and .modules' "$OUT/depcruise.json" > /dev/null || { tail -15 "$OUT/depcruise.err" >&2; return 1; }
  jq '
    def istest: test("\\.test\\.|\\.cases\\.");
    def grp: if test("^src/(lib|components)/[^/]+/") then (split("/") | .[0:3] | join("/")) elif test("^src/app/") then "src/app" else . end;
    [.modules[] | select((.source | startswith("src/")) and (.source | istest | not))] as $prod
    | ([$prod[] as $m | $m.dependencies[]
        | select((.dependencyTypes | index("local")) and (.resolved | startswith("src/")) and (.resolved | istest | not))
        | [($m.source | grp), (.resolved | grp)] | select(.[0] != .[1])] | unique) as $edges
    | ($edges | map(.[0]) + map(.[1]) | unique) as $nodes
    | (reduce $edges[] as $e ({}; .[$e[0]] += [$e[1]])) as $adj
    | def step($r): reduce $nodes[] as $n ($r; .[$n] = ((($r[$n] // []) + [($r[$n] // [])[] as $m | ($r[$m] // [])[]]) | unique));
      ($adj | until(. == step(.); step(.))) as $reach
    | ([$nodes[] as $n | select(($reach[$n] // []) | index($n))
        | ([$n] + [($reach[$n])[] as $m | select(($reach[$m] // []) | index($n)) | $m]) | unique]
       | unique | map(select(length >= 2))) as $sccs
    | ([$prod[] | {module: .source, fanout: ([.dependencies[] | select(.dependencyTypes | index("local")) | .resolved] | unique | length)}]
       | sort_by(-.fanout, .module)) as $fan
    | [.summary.violations[]] as $v
    | {sccCount: ($sccs | length),
       sccSizeSum: ($sccs | map(length) | add // 0),
       sccs: $sccs,
       maxFanout: ($fan[0] // {module: "-", fanout: 0}),
       fanout: $fan[0:10],
       fileCycles: ($v | map(select(.rule.name == "no-circular")) | length),
       violations: ($v | map(select(.rule.name != "no-circular")) | length),
       modules: ($prod | length)}' "$OUT/depcruise.json"
}

# server_feature_surface: 기능 모듈마다 server/app이 import하는 타입 수와 모듈의 공개 선언 수, 그 비율.
measure_server_feature_surface() {
  local m used pub
  for m in room recommendation artifact; do
    [ -d "server/$m/src/main" ] || { echo "server/$m/src/main이 없다" >&2; return 1; }
    used="$(grep -rh "^import app.banbanyeok.server.$m\." server/app/src/main | sort -u | wc -l | tr -d ' ')"
    pub="$(grep -rhE "^public (data |enum |sealed |fun )?(class|interface|object|fun)" "server/$m/src/main" | wc -l | tr -d ' ')"
    printf '%s\t%s\t%s\n' "$m" "$used" "$pub"
  done | jq -Rn '[inputs | split("\t") | {module: .[0], used: (.[1] | tonumber), public: (.[2] | tonumber)}
                  | .ratio = (if .public > 0 then (.used / .public * 100 | round) else 0 end)]'
}

# change_breadth: 최근 14일 커밋마다 테스트·문서·데이터·계약·설정 파일을 뺀 변경 파일을 영역으로 묶어 서로 다른 영역 수를 센다.
# 영역은 server/<모듈>, server/app/<패키지>, web/src/{lib,components,app}/<디렉터리>, shared/<모듈>, pipeline이고,
# 그 밖의 제품 코드는 최상위(web은 두 단계) 디렉터리로 본다. 중앙값·p90(최근접 순위)·최대와 가장 넓게 바꾼 커밋 3개를 낸다.
CHANGE_AWK='
function area(f,    s, n, p) {
  if (f ~ /(^|\/)(test|commonTest|jvmTest|integrationTest|testFixtures|fixtures|e2e[^\/]*)\//) return ""
  if (f ~ /(Test\.kt|\.test\.tsx?|\.spec\.tsx?|\.cases\.tsx?|\.gen\.[a-z]+)$/) return ""
  if (f !~ /\.(kt|ts|tsx)$/) return ""
  n = split(f, s, "/")
  if (s[1] == "server") {
    if (s[2] != "app") return "server/" s[2]
    if (match(f, /\/server\/app\/[^\/]+\//)) {
      p = substr(f, RSTART + 12)
      sub(/\/.*/, "", p)
      return (p ~ /\.kt$/) ? "server/app" : "server/app/" p
    }
    return "server/app"
  }
  if (s[1] == "web" && s[2] == "src" && (s[3] == "lib" || s[3] == "components" || s[3] == "app")) return (n > 4) ? "web/src/" s[3] "/" s[4] : "web/src/" s[3]
  if (s[1] == "shared") return "shared/" s[2]
  if (s[1] == "pipeline") return "pipeline"
  if (s[1] == "web") return (n > 2) ? "web/" s[2] : "web"
  return (n > 1) ? s[1] : "(root)"
}
function flush(    k, c) {
  if (sha != "") {
    c = 0
    for (k in seen) c++
    print c "\t" sha "\t" subj
  }
  delete seen
}
/^@/ { flush(); sha = substr($1, 2); subj = $0; sub(/^@[^ ]* /, "", subj); next }
NF > 0 { a = area($0); if (a != "") seen[a] = 1 }
END { flush() }'

measure_change_breadth() {
  git -c core.quotepath=off log --since="$WINDOW" --no-merges --format='@%h %s' --name-only \
    | awk "$CHANGE_AWK" \
    | jq -Rn '
        [inputs | split("\t") | {areas: (.[0] | tonumber), sha: .[1], subject: (.[2:] | join(" ") | gsub("\\|"; "/"))}] as $c
        | ($c | map(.areas) | sort) as $s
        | if ($s | length) == 0 then error("최근 14일 커밋이 없다") else
          {commits: ($s | length),
           median: (if ($s | length) % 2 == 1 then $s[(($s | length) - 1) / 2] else (($s[($s | length) / 2 - 1] + $s[($s | length) / 2]) / 2) end),
           p90: $s[((($s | length) * 0.9 | ceil) - 1)],
           max: $s[-1],
           widest: ($c | sort_by(-.areas) | .[0:3])} end'
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
  local empty='{"runs":0,"baseline":{},"current":null,"history":[]}' state=""
  if [ -n "$PREVIOUS" ] && [ -f "$PREVIOUS" ]; then
    state="$(awk '/^<!-- architecture-metrics-state/ {f = 1; next} f && /^-->/ {f = 0} f' "$PREVIOUS")"
  fi
  if [ -n "$state" ] && printf '%s' "$state" | jq -e '(.history | type) == "array"' > /dev/null 2>&1; then
    printf '%s' "$state" | jq -c '{runs: (.runs // 0), baseline: (.baseline // {}), current: .current, history: .history}'
  else
    echo "$empty"
  fi
}

# 요약 한 줄(표의 이번·직전·최초 칸과 이력 표가 같이 쓴다). 지표 이름과 그 값을 받는다.
SUMMARY_JQ='
def fmt1: if . == floor then tostring else ((. * 10 | round) / 10 | tostring) end;
def sumstr($k; $v):
  if $v == null then "측정 실패"
  elif $k == "hotspot_top10" then (if ($v.items | length) == 0 then "해당 없음" else "`\($v.items[0].file | split("/") | last)` \($v.items[0].score)" end)
  elif $k == "kotlin_complex_functions" then "순환 10 이상 \($v.cyclomatic10)개, 인지 15 이상 \($v.cognitive15)개"
  elif $k == "web_package_cycles" then "SCC \($v.sccCount)개(크기 합 \($v.sccSizeSum)), 최대 팬아웃 \($v.maxFanout.fanout)"
  elif $k == "server_feature_surface" then ($v | map("\(.module) \(.used)/\(.public)") | join(", "))
  elif $k == "change_breadth" then "중앙값 \($v.median | fmt1), p90 \($v.p90 | fmt1), 최대 \($v.max)"
  else "" end;
def keys5: ["hotspot_top10", "kotlin_complex_functions", "web_package_cycles", "server_feature_surface", "change_breadth"];
def names: {hotspot_top10: "핫스팟", kotlin_complex_functions: "Kotlin 복잡 함수", web_package_cycles: "웹 패키지 순환", server_feature_surface: "서버 기능 모듈 표면", change_breadth: "변경 폭"};'

# 직전 대비 변화가 큰 항목을 한 줄씩 뽑는다. 입력은 {cur, prev}. prev는 지표별로 가장 최근의 성공한 값이다.
# 아래 DELTA_* 기준값은 잠정이다(경보 임계값은 기준값 수집 뒤에 정한다). 처음 두 회차에는 이 요약을 쓰지 않는다.
CHANGES_JQ="$SUMMARY_JQ"'
def DELTA_CYCLOMATIC: 3;
def DELTA_COGNITIVE: 2;
def DELTA_MCC_PER_KLOC: 15;
def DELTA_FANOUT: 3;
def DELTA_SURFACE_TYPES: 3;
def DELTA_SURFACE_RATIO: 10;
def DELTA_MEDIAN: 2;
def DELTA_P90: 3;
def DELTA_MAX: 6;
def sign: if . > 0 then "+\(.)" else "\(.)" end;
def moved($d; $t): $d >= $t or $d <= -$t;
.cur as $c | .prev as $p |
[ (keys5[] as $k | select($c[$k] == null) | "측정 실패: \(names[$k]). 워크플로 실행 로그를 확인하세요."),
  (if $c.hotspot_top10 != null then
     ($c.hotspot_top10.items[] | select(.isNew) | "핫스팟 신규 진입: `\(.file)` (점수 \(.score))"),
     ($c.hotspot_top10.items[] | select(.streak) | "핫스팟 3회 연속 상위 5위: `\(.file)`")
   else empty end),
  (if $c.kotlin_complex_functions != null and $p.kotlin_complex_functions != null then
     ($c.kotlin_complex_functions as $k | $p.kotlin_complex_functions as $o
      | (($k.cyclomatic10 - $o.cyclomatic10) as $d | select(moved($d; DELTA_CYCLOMATIC)) | "순환 복잡도 10 이상 함수 \($o.cyclomatic10)개 -> \($k.cyclomatic10)개 (\($d | sign))"),
        (($k.cognitive15 - $o.cognitive15) as $d | select(moved($d; DELTA_COGNITIVE)) | "인지 복잡도 15 이상 함수 \($o.cognitive15)개 -> \($k.cognitive15)개 (\($d | sign))"),
        ($k.modules[] as $m | ($o.modules | map(select(.module == $m.module)) | .[0]) as $q
         | select($q != null and moved(($m.mccPerKloc - $q.mccPerKloc); DELTA_MCC_PER_KLOC))
         | "`\($m.module)` mcc/1,000 lloc \($q.mccPerKloc) -> \($m.mccPerKloc)"))
   else empty end),
  (if $c.web_package_cycles != null and $p.web_package_cycles != null then
     ($c.web_package_cycles as $k | $p.web_package_cycles as $o
      | (select($k.sccCount != $o.sccCount) | "웹 패키지 SCC \($o.sccCount)개 -> \($k.sccCount)개"),
        (select($k.sccSizeSum != $o.sccSizeSum) | "웹 패키지 SCC 크기 합 \($o.sccSizeSum) -> \($k.sccSizeSum)"),
        (($k.maxFanout.fanout - $o.maxFanout.fanout) as $d | select(moved($d; DELTA_FANOUT)) | "웹 최대 팬아웃 \($o.maxFanout.fanout) -> \($k.maxFanout.fanout) (`\($k.maxFanout.module)`)"))
   else empty end),
  (if $c.server_feature_surface != null and $p.server_feature_surface != null then
     ($c.server_feature_surface[] as $m | ($p.server_feature_surface | map(select(.module == $m.module)) | .[0]) as $o
      | select($o != null and (moved(($m.used - $o.used); DELTA_SURFACE_TYPES) or moved(($m.ratio - $o.ratio); DELTA_SURFACE_RATIO)))
      | "서버 `\($m.module)` 표면: app이 쓰는 타입 \($o.used) -> \($m.used), 공개 선언 \($o.public) -> \($m.public), 비율 \($o.ratio)% -> \($m.ratio)%")
   else empty end),
  (if $c.change_breadth != null and $p.change_breadth != null then
     ($c.change_breadth as $k | $p.change_breadth as $o
      | select(moved(($k.median - $o.median); DELTA_MEDIAN) or moved(($k.p90 - $o.p90); DELTA_P90) or moved(($k.max - $o.max); DELTA_MAX))
      | "변경 폭: 중앙값 \($o.median | fmt1) -> \($k.median | fmt1), p90 \($o.p90 | fmt1) -> \($k.p90 | fmt1), 최대 \($o.max) -> \($k.max)")
   else empty end)
] | map("- " + .) | .[]'

render_summary_table() {
  jq -r --slurpfile prev "$OUT/prev-sections.json" --slurpfile base "$OUT/baseline.json" "$SUMMARY_JQ"'
    . as $c |
    "| 지표 | 이번 | 직전 | 최초(기준) |", "|---|---|---|---|",
    (keys5[] as $k | "| `\($k)` | \(sumstr($k; $c[$k])) | \(if $prev[0][$k] == null then "-" else sumstr($k; $prev[0][$k]) end) | \(if $base[0][$k] == null then "-" else sumstr($k; $base[0][$k]) end) |")' "$OUT/snapshot.json"
}

render_hotspot() {
  jq -r '
    if . == null then "측정 실패" else
    "| 순위 | 파일 | 줄 | 등장(14일) | 점수 | 표시 |", "|---:|---|---:|---:|---:|---|",
    (.items | to_entries[] | .value as $f
      | "| \(.key + 1) | `\($f.file)` | \($f.lines) | \($f.appearances) | \($f.score) | \([(if $f.isNew then "신규" else empty end), (if $f.streak then "3회 연속 상위 5위" else empty end)] | join(", ") | if . == "" then "-" else . end) |") end' "$OUT/hotspot_top10.json"
}

render_kotlin() {
  jq -r '
    if . == null then "측정 실패" else
    "순환 복잡도 10 이상 함수 **\(.cyclomatic10)개**, 인지 복잡도 15 이상 함수 **\(.cognitive15)개**",
    "",
    "| 순위 | 함수 | 위치 | 순환 | 인지 |", "|---:|---|---|---:|---:|",
    (.functions | to_entries[] | .value as $f
      | "| \(.key + 1) | `\($f.fn)` | `\($f.file):\($f.line)` | \(if $f.cyclomatic > 0 then $f.cyclomatic else "-" end) | \(if $f.cognitive > 0 then $f.cognitive else "-" end) |"),
    "",
    "| 모듈 | mcc | lloc | mcc / 1,000 lloc |", "|---|---:|---:|---:|",
    (.modules[] | "| `\(.module)` | \(.mcc) | \(.lloc) | \(.mccPerKloc) |") end' "$OUT/kotlin_complex_functions.json"
}

render_web() {
  jq -r '
    if . == null then "측정 실패" else
    "크기 2 이상 SCC **\(.sccCount)개**(크기 합 \(.sccSizeSum)), 제품 파일 최대 팬아웃 **\(.maxFanout.fanout)**(`\(.maxFanout.module)`)",
    "",
    "파일 단위로는 순환 \(.fileCycles)건, 규칙 위반 \(.violations)건(분석한 제품 파일 \(.modules)개).",
    (if .sccCount > 0 then "", (.sccs | to_entries[] | "- SCC \(.key + 1) (크기 \(.value | length)): \(.value | map("`\(.)`") | join(", "))") else empty end),
    "",
    "| 순위 | 파일 | 팬아웃 |", "|---:|---|---:|",
    (.fanout | to_entries[] | "| \(.key + 1) | `\(.value.module)` | \(.value.fanout) |") end' "$OUT/web_package_cycles.json"
}

render_surface() {
  jq -r '
    if . == null then "측정 실패" else
    "| 기능 모듈 | app이 쓰는 타입 | 공개 선언 | 비율 |", "|---|---:|---:|---:|",
    (.[] | "| `\(.module)` | \(.used) | \(.public) | \(.ratio)% |") end' "$OUT/server_feature_surface.json"
}

render_breadth() {
  jq -r "$SUMMARY_JQ"'
    if . == null then "측정 실패" else
    "최근 14일 커밋 \(.commits)개: 중앙값 **\(.median | fmt1)**, p90 **\(.p90 | fmt1)**, 최대 **\(.max)**개 영역",
    "",
    "| 커밋 | 제목 | 영역 수 |", "|---|---|---:|",
    (.widest[] | "| `\(.sha)` | \(.subject) | \(.areas) |") end' "$OUT/change_breadth.json"
}

# 이력 표. 입력은 스냅샷 배열.
render_history() {
  jq -r "$SUMMARY_JQ"'
    if length == 0 then "기록 없음" else
    "| 날짜 | 기준 커밋 | 핫스팟 1위 | Kotlin 복잡 함수 | 웹 패키지 순환 | 서버 기능 모듈 표면 | 변경 폭 |", "|---|---|---|---|---|---|---|",
    (.[] | . as $s | "| \($s.date) | `\($s.sha)` | \(keys5 | map(sumstr(.; $s[.])) | join(" | ")) |") end'
}

main() {
  local state prev_date now_date week sha run_url="" changes history_json snaps runs collecting

  state="$(read_state)"
  snaps="$(printf '%s' "$state" | jq -c '[.current] + .history | map(select(. != null))')"

  run_measure hotspot_top10 measure_hotspot_top10
  if [ "$(jq -c . "$OUT/hotspot_top10.json")" != "null" ]; then
    annotate_hotspot "$snaps" < "$OUT/hotspot_top10.json" > "$OUT/hotspot_top10.annotated" && mv "$OUT/hotspot_top10.annotated" "$OUT/hotspot_top10.json"
  fi
  run_measure kotlin_complex_functions measure_kotlin_complex_functions
  run_measure web_package_cycles measure_web_package_cycles
  run_measure server_feature_surface measure_server_feature_surface
  run_measure change_breadth measure_change_breadth

  now_date="$(TZ=Asia/Seoul date +%Y-%m-%d)"
  week="$(TZ=Asia/Seoul date +%G-W%V)"
  sha="$(git rev-parse --short=7 HEAD 2> /dev/null || echo unknown)"
  if [ -n "${GITHUB_RUN_ID:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
    run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
  fi

  jq -n --arg date "$now_date" --arg week "$week" --arg sha "$sha" \
    --slurpfile a "$OUT/hotspot_top10.json" --slurpfile b "$OUT/kotlin_complex_functions.json" \
    --slurpfile c "$OUT/web_package_cycles.json" --slurpfile d "$OUT/server_feature_surface.json" \
    --slurpfile e "$OUT/change_breadth.json" \
    '{date: $date, week: $week, sha: $sha, hotspot_top10: $a[0], kotlin_complex_functions: $b[0], web_package_cycles: $c[0],
      server_feature_surface: $d[0], change_breadth: $e[0]}' > "$OUT/snapshot.json" || return 1

  prev_date="$(printf '%s' "$state" | jq -r '.current.date // empty')"
  runs=$(($(printf '%s' "$state" | jq -r '.runs') + 1))
  collecting=false
  [ "$runs" -le "$BASELINE_RUNS" ] && collecting=true
  # 지표별로 가장 최근에 성공한 지난 값. 한 번 실패해도 다음 실행이 그 전 값과 비교할 수 있다.
  printf '%s' "$snaps" | jq -c '
    . as $s | reduce ("hotspot_top10", "kotlin_complex_functions", "web_package_cycles", "server_feature_surface", "change_breadth") as $k
      ({}; .[$k] = ([$s[] | .[$k] | select(. != null)] | first // null))' > "$OUT/prev-sections.json"
  # 최초(기준) 값은 한 번 정해지면 바뀌지 않는다. 최초에 실패한 지표는 처음 성공한 회차의 값이 기준이 된다.
  jq -c -n --argjson state "$state" --slurpfile cur "$OUT/snapshot.json" '
    reduce ("hotspot_top10", "kotlin_complex_functions", "web_package_cycles", "server_feature_surface", "change_breadth") as $k
      ({}; .[$k] = ($state.baseline[$k] // $cur[0][$k]))' > "$OUT/baseline.json"

  jq -c -n --slurpfile cur "$OUT/snapshot.json" --slurpfile prev "$OUT/prev-sections.json" '{cur: $cur[0], prev: $prev[0]}' \
    | jq -r "$CHANGES_JQ" > "$OUT/changes.md"
  changes="$(cat "$OUT/changes.md")"

  history_json="$(printf '%s' "$snaps" | jq -c --argjson keep "$KEEP_HISTORY" '.[0:$keep]')"

  {
    echo "이 이슈는 2주마다 자동으로 갱신됩니다. 리팩터링 후보는 코디네이터가 이 지표를 보고 따로 이슈로 만듭니다."
    echo
    # shellcheck disable=SC2016
    printf '> 측정일 %s (%s), 기준 커밋 `%s`, %s회차.' "$now_date" "$week" "$sha" "$runs"
    if [ -n "$prev_date" ]; then printf ' 직전 측정 %s.' "$prev_date"; fi
    if [ -n "$run_url" ]; then printf ' [실행 로그](%s)' "$run_url"; fi
    echo
    echo
    echo "## 직전 대비 변화"
    echo
    if [ "$collecting" = true ]; then
      echo "**기준값 수집 중** (${runs}/${BASELINE_RUNS}회차). 처음 두 회차(약 4주)는 기록만 하고 경보 기준을 두지 않습니다. 아래 표의 \"최초(기준)\" 열이 이번 값을 기준으로 남습니다."
      changes="$(printf '%s\n' "$changes" | grep '^- 측정 실패' || true)"
      [ -z "$changes" ] || { echo; echo "$changes"; }
    elif [ -n "$changes" ]; then
      echo "$changes"
      echo
      echo "기준은 잠정입니다(경보 임계값은 기준값 수집 뒤에 정합니다)."
    else
      echo "큰 변화 없음."
    fi
    echo
    echo "## 지표 요약"
    echo
    render_summary_table
    echo
    echo "## 1. 핫스팟 (\`hotspot_top10\`)"
    echo
    echo "제품 코드 파일(\`.kt\`, \`.ts\`, \`.tsx\`)마다 현재 줄 수 x 최근 14일 \`git log\` 등장 횟수의 상위 10. 테스트, \`e2e*/\`, \`*.gen.*\`, \`web/mock/\`, \`*.cases.ts\`, 처리방침 본문(\`web/src/app/privacy/policy.ts\`)은 뺀다. 직전 상위 10에 없던 파일은 \"신규\", 3회 연속 상위 5위면 표시한다."
    echo
    render_hotspot
    echo
    echo "## 2. Kotlin 복잡 함수 (\`kotlin_complex_functions\`)"
    echo
    echo "server·shared·pipeline의 main 소스만 본다. 저장소 설정(\`config/detekt/detekt.yml\`)은 그대로 두고, 임계값을 낮춘 설정(순환 9, 인지 14: \`scripts/detekt-metrics.yml\`)을 init 스크립트(\`scripts/detekt-metrics.init.gradle\`)로 주입해 \`./gradlew detekt\`를 돌린다. mcc는 같은 실행의 detekt main 보고서 값이다."
    echo
    render_kotlin
    echo
    echo "## 3. 웹 패키지 순환 (\`web_package_cycles\`)"
    echo
    echo "\`web/src\`를 dependency-cruiser로 읽고, 테스트·\`.cases.\` 파일을 뺀 뒤 노드를 \`src/(lib|components)/<dir>\`로 묶은 그래프에서 크기 2 이상의 강한 연결 요소(SCC)를 센다. 팬아웃은 제품 파일 하나가 import하는 \`src\` 안의 다른 파일 수다."
    echo
    render_web
    echo
    echo "## 4. 서버 기능 모듈 표면 (\`server_feature_surface\`)"
    echo
    echo "기능 모듈마다 \`server/app\`이 import하는 타입 수(서로 다른 \`import app.banbanyeok.server.<모듈>.\`)와 모듈 main의 \`public\` 선언 수, 그 비율이다. 비율이 높을수록 app이 모듈 내부를 넓게 안다."
    echo
    render_surface
    echo
    echo "## 5. 변경 폭 (\`change_breadth\`)"
    echo
    echo "최근 14일 커밋마다 테스트·문서·데이터·계약·설정을 뺀 변경 파일을 영역(\`server/<모듈>\`, \`server/app/<패키지>\`, \`web/src/{lib,components,app}/<디렉터리>\`, \`shared/<모듈>\`, \`pipeline\`)으로 묶어 서로 다른 영역 수를 센다. 아래 표는 가장 넓게 바꾼 커밋 3개다."
    echo
    render_breadth
    echo
    echo "<details>"
    echo "<summary>이력 (직전 ${KEEP_HISTORY}회)</summary>"
    echo
    printf '%s' "$history_json" | render_history
    echo
    echo "</details>"
    echo
    echo "측정 방법은 \`scripts/architecture-metrics.sh\`에 있고 로컬에서도 \`bash scripts/architecture-metrics.sh\`로 돈다. 아래 숨은 블록은 다음 실행이 비교에 쓰는 값(최초 기준값, 직전 값, 이력)이다. 지우지 마세요."
    echo
    echo "<!-- architecture-metrics-state"
    # "-->"가 본문 중간에서 주석을 닫지 않도록 '>'를 이스케이프한다(JSON 문자열 안에서만 나온다).
    jq -c -n --argjson runs "$runs" --slurpfile base "$OUT/baseline.json" --slurpfile cur "$OUT/snapshot.json" --argjson hist "$history_json" \
      '{version: 2, runs: $runs, baseline: $base[0], current: $cur[0], history: $hist}' | sed 's/>/\\u003e/g'
    echo "-->"
  } > "$OUT/body.md"

  echo "이슈 본문: $OUT/body.md ($(wc -c < "$OUT/body.md" | tr -d ' ')바이트)" >&2
}

main
