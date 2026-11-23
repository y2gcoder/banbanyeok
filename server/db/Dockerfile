# 운영 마이그레이션 이미지: 로컬(compose.yaml의 migrate)과 같은 공식 Liquibase 이미지에 PostgreSQL JDBC와 SQL changelog를 얹는다.
# 서버 이미지에 liquibase-core를 넣지 않는 이유: 서버 시작·AppCDS 클래스패스·이미지 크기(콜드스타트)를 건드리지 않고,
# 개발과 운영이 같은 Liquibase(5.0.4)를 쓰기 위해서다(docs/setup/p8a-notes.md).
# 빌드 컨텍스트는 저장소 루트: docker build -f server/db/Dockerfile .
# 접속 정보는 이미지에 없다. Cloud Run Job이 환경 변수로 넣는다:
#   LIQUIBASE_COMMAND_URL / LIQUIBASE_COMMAND_USERNAME(비밀 아님), LIQUIBASE_COMMAND_PASSWORD(Secret Manager).
# 태그(5.0.4, 2026-08-20 게시; Docker Hub tags API)와 다이제스트를 같이 고정한다(2026-11-24 확인, 7일 경과).
# 다이제스트는 `docker buildx imagetools inspect`로 확인했다. compose도 같은 빌드 인자를 쓴다.
ARG LIQUIBASE_IMAGE=liquibase/liquibase:5.0.4@sha256:060f96efff4811ccf03957ff3160f21ea04139b89940640f8ad54a065cdc6906
FROM ${LIQUIBASE_IMAGE}
# 5.0 Community에는 JDBC 드라이버가 없다. 공식 /liquibase/lib 설치 방법으로 빌드 때 추가한다:
# https://github.com/liquibase/docker#-including-drivers-and-extensions (2026-11-24 확인)
# LPM 내장 목록에 없는 42.7.14(2026-10-07 게시)를 Gradle postgres-jdbc와 맞추고 SHA-256으로 검증한다.
# SHA-256: 73914527305a40cce504b0d3d90b23caf565136912d607ae8ae7c5895512332c (Maven Central JAR)
ADD --chown=liquibase:liquibase --chmod=644 --checksum=sha256:73914527305a40cce504b0d3d90b23caf565136912d607ae8ae7c5895512332c \
    https://repo.maven.apache.org/maven2/org/postgresql/postgresql/42.7.14/postgresql-42.7.14.jar /liquibase/lib/postgresql-42.7.14.jar
COPY --chown=liquibase:liquibase server/db/changelog/ /liquibase/changelog/
CMD ["--search-path=/liquibase/changelog", "--changelog-file=master.sql", "update"]
