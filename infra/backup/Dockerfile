# DB 백업 Cloud Run Job 이미지: Postgres 17 클라이언트(pg_dump·pg_restore) + 업로드 스크립트. 서버 이미지와 따로 둔다.
# 빌드 컨텍스트는 저장소 루트: docker build -f infra/backup/Dockerfile .
# 베이스는 postgres:17.6-alpine(운영 DB 메이저 17, S1 노트의 17.6과 같은 버전)을 다이제스트로 고정한다.
# 서버와 같은 서울 리전의 Cloud Run Job으로만 실행하며 GitHub 러너는 DB 비밀번호나 덤프를 만지지 않는다.
FROM postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94
RUN apk add --no-cache curl
COPY scripts/db-backup.sh /app/db-backup.sh
COPY infra/backup/job.sh /app/job.sh
RUN chmod 0555 /app/db-backup.sh /app/job.sh
USER postgres
ENTRYPOINT ["/app/job.sh"]
