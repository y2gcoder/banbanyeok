# ADR-0003: Liquibase Community 5의 FSL 수용과 실행 환경 통일

- 상태: accepted (운영자 결정, 2026-11-24)

테스트 픽스처가 PR #125에서 Liquibase 5.0.4로 올라갔지만 로컬·운영 마이그레이션은 4.33.0에 남아 있었다.
기존 5.x 제외 결정(docs/setup/p8a-notes.md)은 라이선스 변경 때문이었다.
운영자는 경쟁 상품을 만들지 않는 서비스이므로 FSL을 수용하기로 했다([공식 라이선스](https://github.com/liquibase/liquibase/blob/v5.0.4/LICENSE.txt)).

개발·테스트·운영을 5.0.4로 통일하고 공식 Community 이미지의 태그와 다이제스트를 고정한다.
5.0부터 기본 이미지에 JDBC 드라이버가 없으므로 Gradle과 같은 PostgreSQL JDBC 42.7.14를 빌드 때 `/liquibase/lib`에 넣는다.
LPM 내장 목록에는 이 버전이 없어 Maven Central JAR를 SHA-256 검증 후 추가하며, 로컬과 운영은 같은 Dockerfile을 쓴다.
서버 시작과 분리된 마이그레이션 작업이라는 기존 결정은 유지한다.
