# 비밀값 템플릿: 값이 아니라 1Password 참조(op://)만 담아 커밋한다.
# 원본은 개인 1Password 계정의 `banbanyeok` vault다(docs/setup/accounts.md의 항목 이름과 같다).
# 실행: op run --env-file=.env.tpl -- <명령>   (mise run dev:server / dev:pipeline / dev:web 가 감싸 준다)
# OP_ACCOUNT를 mise.local.toml로 개인 계정에 고정해 두면 회사 계정과 섞이지 않는다. 확인: mise run doctor
#
# 규칙: 클라이언트(웹·앱) 번들에 들어가는 값(NEXT_PUBLIC_*, PostHog phc_ 프로젝트 토큰, API 기본 URL)은
#       비밀이 아니므로 이 파일이 아니라 각 앱의 설정에 둔다.
#
# 아직 1Password 항목이 없는 키는 주석으로 둔다. 키를 발급해 항목을 만들면 주석을 풀고
# docs/setup/accounts.md의 상태를 ✅로 바꾼다. (없는 항목을 참조하면 op run이 실패하므로 미리 풀지 않는다.)

# --- 파이프라인 (웨이브 1, P2) ---
# 서울 열린데이터광장 인증키 (accounts.md: 안 함)
# SEOUL_OPENAPI_KEY=op://banbanyeok/seoul-opendata/credential
# 공공데이터포털 TAGO 지하철정보 서비스키 (accounts.md: 안 함)
# TAGO_SERVICE_KEY=op://banbanyeok/data-go-kr-tago/credential

# --- 서버 (웨이브 1, P3) ---
# 로컬 DB는 Docker라 비밀번호가 필요 없다. 운영 DB URL·토큰 해시 페퍼는 Secret Manager에서 주입한다.
# DATABASE_URL=op://banbanyeok/db-url-dev/credential

# --- 웹 (웨이브 2, P4) ---
# 서버 전용 값만 둔다. 예: 카카오 REST 키 등이 필요해지면 여기에 추가한다.
