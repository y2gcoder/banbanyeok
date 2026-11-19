#!/bin/sh
# 컨테이너 진입점. 클래스패스는 학습(AppCDS)과 같은 /app/classpath.txt를 쓴다: JAR 나열 순서가 다르면 아카이브를 못 쓴다
# (spikes/REPORT.md 5절). 아카이브가 없거나 맞지 않으면 JVM이 조용히 일반 기동으로 넘어간다(-Xshare:auto).
set -eu
# -XX:-UseBASE64Intrinsics는 CVE-2026-114938(Java4Shell, x86-64 HotSpot Base64 디코더 버그)의 임시 완화다(#66). server/Dockerfile의 cds 단계 java 명령과 같은 자리에 둔다.
# Temurin 25.0.5.1 이상으로 올리는 PR에서 두 곳 모두 뺀다.
exec java -Xms32m -Xmx256m -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UseBASE64Intrinsics -Xshare:auto -XX:SharedArchiveFile=/app/app.jsa -XX:+ExitOnOutOfMemoryError \
  -cp "$(cat /app/classpath.txt)" app.banbanyeok.server.app.MainKt "$@"
