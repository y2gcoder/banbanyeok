# syntax=docker/dockerfile:1
# 서버 이미지. 플랫폼은 빌드 명령이 정한다(linux/amd64, Cloud Run). 빌드는 scripts/build-server-image.sh: ./gradlew :server:app:installDist 후 저장소 루트를 컨텍스트로 docker build.
# Cloud Run(서울, min 0) 콜드스타트를 줄이려고 AppCDS 아카이브를 이미지 안에서 학습한다(spikes/REPORT.md 3·5절).
# 아카이브는 같은 JDK·OS·CPU 구조·클래스패스에서만 쓸 수 있어서 호스트에서 만들어 복사하지 않고 이 이미지에서 만든다.
ARG JRE_IMAGE=eclipse-temurin:25.0.5_8-jre-noble

FROM ${JRE_IMAGE} AS base
WORKDIR /app
COPY server/app/build/install/app/lib/ /app/lib/
COPY server/app/build/install/app/classpath.txt /app/classpath.txt
COPY server/app/docker/run.sh /app/run.sh
RUN chmod 0555 /app/run.sh

# 학습: 로컬 프로필로 서버를 띄워 자주 쓰는 경로(health, manifest, 추천, 오류 응답, DB 접근 시도)를 한 번씩 지나가게 한 뒤
# 정상 종료해서 아카이브를 쓴다. DB는 없다: 연결 실패 경로가 Hikari·Exposed·JDBC 클래스를 읽게 한다. 산출물은 학습에만 쓰고 최종 이미지에 넣지 않는다.
# 산출물은 운영과 같은 경로(GCS 클라이언트·인증·HTTP 전송)로 읽게 해서 그 클래스도 아카이브에 넣는다: 학습 때만 로컬 GCS 에뮬레이터
# (fake-gcs-server, 버킷 이름 training)를 띄우고 ARTIFACT_GCS_ENDPOINT로 가리킨다. 에뮬레이터는 최종 이미지에 들어가지 않는다.
FROM fsouza/fake-gcs-server:1.56.1 AS gcsemu

FROM base AS cds
COPY --from=gcsemu /bin/fake-gcs-server /usr/local/bin/fake-gcs-server
COPY data/artifacts/dev/ /training/gcs/training/
# -XX:-UseBASE64Intrinsics는 CVE-2026-114938(Java4Shell, x86-64 HotSpot Base64 디코더 버그)의 임시 완화다(#66). server/app/docker/run.sh의 실행 옵션과 같은 자리에 둬야 한다.
# Temurin 25.0.5.1 이상으로 올리는 PR에서 두 곳 모두 뺀다.
RUN bash -c 'set -eu; \
  fake-gcs-server -scheme http -port 4443 -data /training/gcs -backend memory > /tmp/gcs-emulator.log 2>&1 & \
  for i in $(seq 1 60); do (exec 3<>/dev/tcp/127.0.0.1/4443) 2>/dev/null && break; sleep 1; done; \
  export APP_PROFILE=local SERVER_PORT=8080 ARTIFACT_STORE=gcs ARTIFACT_GCS_BUCKET=training \
    ARTIFACT_GCS_ENDPOINT=http://127.0.0.1:4443 \
    DATABASE_URL=jdbc:postgresql://127.0.0.1:1/none RATE_LIMIT_ENABLED=false; \
  java -Xms32m -Xmx256m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UseBASE64Intrinsics -XX:ArchiveClassesAtExit=/app/app.jsa -cp "$(cat /app/classpath.txt)" app.banbanyeok.server.app.MainKt \
    > /tmp/training.log 2>&1 & pid=$!; \
  ready=0; for i in $(seq 1 120); do \
    if (exec 3<>/dev/tcp/127.0.0.1/8080; printf "GET /healthz HTTP/1.0\r\n\r\n" >&3; read -r line <&3; [[ "$line" == *200* ]]) 2>/dev/null; then ready=1; break; fi; sleep 1; done; \
  test $ready -eq 1; \
  req() { (exec 3<>/dev/tcp/127.0.0.1/8080; printf "%s" "$1" >&3; timeout 30 cat <&3 > /dev/null) || true; }; \
  body="{\"origins\":[\"02f\",\"dd9\"],\"mode\":\"fair\",\"timeSlot\":\"saturday-night\"}"; \
  req "GET /v1/manifest HTTP/1.0\r\n\r\n"; \
  req "POST /v1/recommend HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: ${#body}\r\n\r\n$body"; \
  req "POST /v1/rooms HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"; \
  req "GET /v1/rooms/abcdefghjk HTTP/1.0\r\n\r\n"; \
  kill -TERM $pid; wait $pid || true; \
  test -s /app/app.jsa'

FROM base
COPY --from=cds /app/app.jsa /app/app.jsa
RUN useradd --system --uid 10001 --no-create-home app && chown -R app /app
USER 10001
ENV PORT=8080 APP_PROFILE=prod
EXPOSE 8080
ENTRYPOINT ["/app/run.sh"]
