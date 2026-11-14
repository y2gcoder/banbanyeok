#!/usr/bin/env bash
# 개발 환경 점검: mise run doctor
# 비밀값은 출력하지 않는다. 실패 항목이 하나라도 있으면 종료 코드 1.
set -u
cd "$(dirname "$0")/.."

failures=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; failures=$((failures + 1)); }

# 실제로 실행되는 버전이 mise.toml에 고정한 버전과 같은지 본다(셸에 mise가 활성화돼 있지 않으면 어긋난다).
check_tool() { # 이름, 실제 버전, 고정 버전 앞부분
  local name=$1 actual=$2 want=$3
  if [[ -z $actual ]]; then bad "$name: 실행할 수 없습니다 (mise install 후 셸에서 mise activate 필요)"
  elif [[ $actual == "$want"* ]]; then ok "$name $actual"
  else bad "$name $actual (mise.toml 고정: $want...). 'mise install' 후 새 셸에서 다시 실행하세요"; fi
}

want() { mise current "$1" 2>/dev/null | awk '{print $1}' | sed 's/^temurin-//; s/+.*//'; }

echo "도구 버전"
java_actual=$(java -version 2>&1 | sed -n '1s/.*"\([0-9][0-9.]*\)[^"]*".*/\1/p')
check_tool java   "$java_actual" "$(want java)"
check_tool node   "$(node --version 2>/dev/null | sed 's/^v//')" "$(want node)"
check_tool pnpm   "$(pnpm --version 2>/dev/null)" "$(want pnpm)"
check_tool gitleaks "$(gitleaks version 2>/dev/null)" "$(want gitleaks)"
check_tool lefthook "$(lefthook version 2>/dev/null)" "$(want lefthook)"
py=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null)
if [[ -n $py ]] && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then ok "python3 $py (프로토타입은 3.9 이상)"; else bad "python3 3.9 이상이 필요합니다"; fi
[[ -x ./gradlew ]] && ok "gradle wrapper 있음" || bad "gradlew가 없습니다"

echo "비밀값 보호"
if [[ -f .git/hooks/pre-commit ]] || [[ -f "$(git rev-parse --git-common-dir 2>/dev/null)/hooks/pre-commit" ]]; then
  ok "git pre-commit 훅 설치됨"
else
  warn "pre-commit 훅이 없습니다: mise run hooks:install"
fi
[[ -f .gitleaks.toml ]] && ok ".gitleaks.toml 있음" || bad ".gitleaks.toml이 없습니다"

echo "Docker"
if docker info >/dev/null 2>&1; then ok "Docker 실행 중"; else bad "Docker를 실행하세요"; fi

echo "1Password (선택; 비밀값이 필요한 작업에서만 사용)"
if [[ -n ${OP_SERVICE_ACCOUNT_TOKEN:-} ]]; then
  warn "OP_SERVICE_ACCOUNT_TOKEN이 설정돼 있습니다. CLI가 개인 로그인이 아니라 그 서비스 계정으로 동작합니다(회사 토큰일 수 있음). mise.local.toml에서 해제하세요"
else
  ok "OP_SERVICE_ACCOUNT_TOKEN 없음"
fi

if ! command -v op >/dev/null 2>&1; then
  warn "op(1Password CLI)가 없습니다"
elif [[ -z ${OP_ACCOUNT:-} ]]; then
  warn "OP_ACCOUNT가 비어 있습니다. mise.local.toml.example을 mise.local.toml로 복사해 개인 계정을 지정하세요. (회사 계정과 섞이는 것을 막습니다)"
else
  ok "OP_ACCOUNT 지정됨 (값은 출력하지 않음)"
  if who=$(op whoami --format json 2>&1); then
    url=$(printf '%s' "$who" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("url",""))' 2>/dev/null)
    uuid=$(printf '%s' "$who" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("account_uuid",""))' 2>/dev/null)
    if [[ $OP_ACCOUNT == "$url" || $OP_ACCOUNT == "$uuid" ]]; then
      ok "op whoami: 로그인 계정이 OP_ACCOUNT와 같습니다 ($url)"
    else
      warn "op whoami의 계정($url)이 OP_ACCOUNT와 다릅니다. 다른 계정으로 로그인돼 있을 수 있습니다"
    fi
    if op vault get banbanyeok >/dev/null 2>&1; then
      ok "vault 'banbanyeok' 접근 가능"
    else
      warn "vault 'banbanyeok'에 접근할 수 없습니다(개인 계정이 아니거나 앱 연동이 꺼져 있음)"
    fi
  else
    warn "op whoami 실패: 1Password 데스크톱 앱을 잠금 해제하고 CLI 연동을 켜세요 (op의 응답: $(printf '%s' "$who" | tr '\n' ' ' | cut -c1-120))"
  fi
fi

echo
if (( failures )); then
  printf '\033[31m%d개 항목이 실패했습니다.\033[0m\n' "$failures"
  exit 1
fi
printf '\033[32m모두 통과했습니다.\033[0m\n'
