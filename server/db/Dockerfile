# 운영 마이그레이션 이미지: 로컬(compose.yaml의 migrate)과 같은 공식 Liquibase 이미지에 SQL changelog만 얹는다.
# 서버 이미지에 liquibase-core를 넣지 않는 이유: 서버 시작·AppCDS 클래스패스·이미지 크기(콜드스타트)를 건드리지 않고,
# 개발과 운영이 같은 Liquibase(4.33.0)를 쓰기 위해서다(docs/setup/p8a-notes.md).
# 빌드 컨텍스트는 저장소 루트: docker build -f server/db/Dockerfile .
# 접속 정보는 이미지에 없다. Cloud Run Job이 환경 변수로 넣는다:
#   LIQUIBASE_COMMAND_URL / LIQUIBASE_COMMAND_USERNAME(비밀 아님), LIQUIBASE_COMMAND_PASSWORD(Secret Manager).
# 태그(4.33.0, 2025-07-09 게시)와 다이제스트를 같이 고정한다. 다이제스트는 `docker buildx imagetools inspect`로 확인했다.
FROM liquibase/liquibase:4.33.0@sha256:e116c935ba22b59a22165207f65c268e363269de30bb1fedacff3755c2abaa8c
COPY --chown=liquibase:liquibase server/db/changelog/ /liquibase/changelog/
CMD ["--search-path=/liquibase/changelog", "--changelog-file=master.sql", "update"]
