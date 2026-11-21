# W56 Artifact Registry 정리 정책: 보존 30개 (#107)

## 왜
- `server` 저장소 정책이 최근 **3**개만 남겼다. 서버 빌드 한 번이 패키지(`server`·`migrate`·`backup`)마다 버전을 3개(이미지 인덱스 1 + 태그 없는 매니페스트 2) 올리므로 사실상 마지막 빌드 하나뿐이었다.
- `deploy-server.yml`은 공개 스모크가 실패하면 직전 리비전으로 되돌린다. 그 이미지가 지워졌으면 되돌림·콜드 스타트가 실패할 수 있다.
- 결정: 최근 **30**개 보존(패키지당 약 10번 빌드). `keepCount`는 패키지별로 센다.

## 파일
- `infra/registry/cleanup-policy.json`: 정책(삭제 any + 보존 30). 이유는 `infra/registry/README.md`.
- `scripts/registry-cleanup-policy.sh`: `show` / `dry-run` / `apply --yes`.

## 적용(운영자, 병합 뒤)
```
scripts/registry-cleanup-policy.sh show
scripts/registry-cleanup-policy.sh dry-run
scripts/registry-cleanup-policy.sh apply --yes
```
- `--dry-run`도 정책을 바꾸고 "삭제 없이 로그만" 모드가 된다. 확인 뒤 반드시 `apply --yes`로 실제 모드로 돌린다.
- 보존이 삭제보다 우선한다(같은 버전이 둘 다에 걸리면 보존).
- 공식 문서: https://cloud.google.com/artifact-registry/docs/repositories/cleanup-policy
- 비용(저장 용량 대비 개수)은 적용 뒤 이미지 크기로 확인한다.
