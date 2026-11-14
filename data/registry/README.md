# 역 코드 레지스트리

**자리표시 파일이다.** 실제 역 데이터(코드 발급, 이름, 좌표, 기관별 코드)는 P2(파이프라인)가 만든다.

- 형식: [contracts/data-format.md](../../contracts/data-format.md) §2~§3
- `stations.json`은 **append-only**다. 한 번 발급한 코드는 삭제·재사용하지 않고, 폐역·개명은 `status: "deprecated"`와 `aliases`로 처리한다.
  파이프라인과 CI는 `RegistryCompatibility.checkAppendOnly(이전 main, 새 파일)`로 위반을 막는다.
- `candidates.json`은 추천 후보역 목록(코드 오름차순)이다. od.bin의 후보 축과 같은 집합·순서여야 한다.
- `candidate-proposals.json`은 D1(수도권 확장)에서 새 범위의 만남 후보로 **제안만** 한 목록이다. `candidate-review.json`과 같은 형식이며 빌드·후보 축에 쓰지 않는다. 사람이 검토해 `data/config/candidate-places.csv`로 옮겨야 반영된다([d1-notes](../../docs/setup/d1-notes.md) 4절).
- 이 폴더의 JSON이 형식에 맞는지는 `shared/schema`의 `DataRegistryFilesTest`(jvmTest)가 매번 검사한다.
- 장난감 노선도로 만든 예시는 `contracts/fixtures/`에 있다. 실제 역·시간이 아니다.
