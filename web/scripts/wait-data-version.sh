#!/usr/bin/env bash
# 웹 스모크 전에 서버가 이 웹 빌드와 같은 데이터를 발행했는지 기다린다(.github/workflows/deploy-web.yml이 부른다).
#   BASE_URL   배포된 웹 주소(필수). /api/v1/manifest는 Worker 프록시를 거쳐 서버 manifest를 돌려준다
#   EXPECTED   기다릴 dataVersion(없으면 src/lib/stations/index.gen.json의 값)
#   INTERVAL   확인 간격 초(기본 30), MAX_WAIT 최대 대기 초(기본 1500 = 25분)
#              MAX_WAIT는 요청 시간까지 포함한 경과 시간 기준이다. 마지막 요청(최대 20초)까지 합쳐 MAX_WAIT+20초 안에 끝난다.
#              (워크플로 단계 timeout과 뒤의 되돌리기 시간을 이 상한으로 계산한다: .github/workflows/deploy-web.yml)
#
# 같은 커밋의 deploy-server와 deploy-web은 따로 돈다. 웹이 먼저 끝나면 새 역 색인(새 출발역 코드)으로 아직 옛 데이터인
# 서버를 불러 /api/v1/recommend가 400이 된다. 그래서 서버 dataVersion이 웹 빌드의 값 이상이 될 때까지 기다린다.
# 서버가 더 새 버전이면 통과로 본다: 레지스트리는 append-only라(contracts/data-format.md §3) 옛 색인의 코드는 새 서버에서도
# 같은 역이고(폐기 코드는 replacedBy로 풀림), 더 새 데이터의 웹 배포가 뒤따른다.
# 웹 빌드의 역 색인이 권역 데이터로 만들어졌으면(index.gen.json에 regions가 있음, ADR-0008) 서버 manifest도 권역 세대(schemaVersion 5)여야
# 한다: 서버가 권역 데이터를 실은 것을 확인한 뒤에만 웹이 부산권 화면을 연다. 수도권만인 색인은 어느 세대의 서버와도 통과한다(되돌리기에서
# 웹을 먼저 내릴 때 서버는 아직 권역 세대다). REGIONAL로 덮어쓸 수 있다(true|false).
# 비밀값은 다루지 않는다. 버전은 YYYYMMDD.N이라 날짜와 N을 숫자로 비교한다(문자열 비교는 .10 < .9가 된다).
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${BASE_URL:?BASE_URL이 필요합니다}"
BASE_URL="${BASE_URL%/}"
EXPECTED="${EXPECTED:-$(jq -r .dataVersion "$here/../src/lib/stations/index.gen.json")}"
REGIONAL="${REGIONAL:-$(jq -r 'has("regions")' "$here/../src/lib/stations/index.gen.json")}"
INTERVAL="${INTERVAL:-30}"
MAX_WAIT="${MAX_WAIT:-1500}"
pattern='^[0-9]{8}\.[0-9]{1,3}$'

[[ "$EXPECTED" =~ $pattern ]] || { echo "FAIL 웹 빌드의 dataVersion 형식 오류: '$EXPECTED'"; exit 1; }

# 0: a == b, 1: a > b, 2: a < b
compare() {
  local a_day="${1%%.*}" a_rev="${1##*.}" b_day="${2%%.*}" b_rev="${2##*.}"
  if ((10#$a_day != 10#$b_day)); then ((10#$a_day > 10#$b_day)) && return 1 || return 2; fi
  if ((10#$a_rev != 10#$b_rev)); then ((10#$a_rev > 10#$b_rev)) && return 1 || return 2; fi
  return 0
}

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
start=$SECONDS
reason="아직 확인 전"
echo "== 서버 데이터 대기: $BASE_URL/api/v1/manifest 의 dataVersion >= $EXPECTED, 권역 세대 필요=$REGIONAL (최대 ${MAX_WAIT}초)"
while :; do
  status="$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' "$BASE_URL/api/v1/manifest" 2>/dev/null || echo 000)"
  if [ "$status" = "200" ]; then
    served="$(jq -r '.dataVersion // empty' "$body" 2>/dev/null || true)"
    schema="$(jq -r '.schemaVersion // empty' "$body" 2>/dev/null || true)"
    if [[ "$REGIONAL" == true && "$schema" != 5 ]]; then
      reason="웹 빌드는 권역 데이터인데 서버 manifest는 schemaVersion '${schema}' (권역 세대 5를 아직 싣지 않음)"
    elif [[ "$served" =~ $pattern ]]; then
      compare "$served" "$EXPECTED"
      case $? in
        0) echo "ok   서버 dataVersion $served = 웹 빌드"; exit 0 ;;
        1) echo "ok   서버 dataVersion $served > 웹 빌드 $EXPECTED (더 새 데이터: append-only 레지스트리라 호환, 다음 웹 배포가 따라온다)"; exit 0 ;;
        *) reason="서버가 아직 옛 데이터 $served (웹 빌드 $EXPECTED)" ;;
      esac
    else
      reason="manifest 응답에 dataVersion이 없거나 형식이 다름: '${served}'"
    fi
  else
    reason="/api/v1/manifest status=$status"
  fi
  waited=$((SECONDS - start))
  if ((waited >= MAX_WAIT)); then
    echo "FAIL ${MAX_WAIT}초 안에 서버가 웹 빌드의 데이터($EXPECTED)를 발행하지 않았습니다: $reason"
    echo "     같은 커밋의 deploy-server(데이터 발행)가 끝났는지 확인한 뒤 이 워크플로를 다시 실행하세요."
    exit 1
  fi
  pause=$((MAX_WAIT - waited))
  ((pause > INTERVAL)) && pause=$INTERVAL
  echo "   (${waited}s) $reason, ${pause}초 뒤 다시 확인"
  sleep "$pause"
done
