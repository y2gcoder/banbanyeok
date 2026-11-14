#!/bin/sh
# 컨테이너 진입점. 클래스패스는 학습(AppCDS)과 같은 /app/classpath.txt를 쓴다: JAR 나열 순서가 다르면 아카이브를 못 쓴다
# (spikes/REPORT.md 5절). 아카이브가 없거나 맞지 않으면 JVM이 조용히 일반 기동으로 넘어간다(-Xshare:auto).
set -eu
exec java -Xms32m -Xmx256m -Xshare:auto -XX:SharedArchiveFile=/app/app.jsa -XX:+ExitOnOutOfMemoryError \
  -cp "$(cat /app/classpath.txt)" app.banbanyeok.server.app.MainKt "$@"
