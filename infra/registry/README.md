# Artifact Registry 정리 정책 (`server` 저장소)

`cleanup-policy.json`을 `scripts/registry-cleanup-policy.sh`로 적용한다(#107). JSON은 주석을 못 쓰므로 이유는 여기에 둔다.

- 규칙: `delete-all-but-recent`(모든 버전 삭제 후보) + `keep-recent`(패키지별 최근 **30**개는 보존). 보존이 삭제보다 우선한다(공식 문서).
- `keepCount`는 `packageNamePrefixes`를 생략하면 **패키지별**로 센다. 이 저장소의 패키지는 `server`, `migrate`, `backup` 셋이다(`.github/workflows/deploy-server.yml`).
- 빌드 한 번이 패키지마다 버전을 **3개** 올린다(태그가 붙는 이미지 인덱스 1 + 태그 없는 플랫폼 매니페스트 2). Cloud Run 리비전은 인덱스가 아니라 매니페스트 다이제스트를 저장한다.
- 그래서 30개 = 패키지당 약 **10번 빌드**. 예전 3개는 사실상 마지막 빌드 하나뿐이라 되돌림·직전 리비전 이미지가 지워질 수 있었다.
