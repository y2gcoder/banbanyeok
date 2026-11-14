#!/usr/bin/env bash
# 서버 이미지를 만든다(linux/amd64, AppCDS 학습 포함). 배포는 하지 않는다(P8).
# 사용: bash scripts/build-server-image.sh [이미지 이름:태그]   (기본 banbanyeok-server:local)
set -euo pipefail
cd "$(dirname "$0")/.."
image="${1:-banbanyeok-server:local}"
./gradlew :server:app:installDist --console=plain -q
docker build --platform linux/amd64 -f server/Dockerfile -t "$image" .
echo "built $image"
