# F1 작은 후속 묶음

검증일: 2026-11-14. 새 의존성·버전 변경과 새 suppress/baseline은 없다.

## 변경

- 표시 이름은 trim 후 같은 이름끼리 입력 순서대로 번호를 붙인다. 이름이 있는 숨긴 참가자도 포함하며 역 이름 번호와는 별도로 센다. 계약 벡터와 추천 이유 문장 스냅샷, 서버 기대값을 갱신했다.
- artifact store 두 구현과 Exposed repository 두 구현의 8개 IO 전환을 생성자 `CoroutineDispatcher` 주입으로 변경했다. 조립 지점의 기본값만 `Dispatchers.IO`이며 테스트는 `UnconfinedTestDispatcher`, 파일 IO 스케줄 검증은 `StandardTestDispatcher`를 쓴다. `InjectDispatcher`를 다시 켰다.
- 파이프라인의 JSON 출력은 재귀 키 정렬, 2칸 들여쓰기, UTF-8, 끝 줄바꿈 하나로 통일한다. 배열 순서는 유지한다. 산출물 receipt는 최종 출력 바이트로 계산한다. `prettyPrintIndent` 설정의 라이브러리 opt-in만 사용하며 분석 예외를 추가하지 않는다.
- `mise run data:refresh`는 파이프라인 `all` 다음 웹 역 인덱스 생성을 순서대로 실행한다. 배차 API 갱신은 별도다.

## 산출물 비교

코디네이터 승인으로 data/registry, data/artifacts/dev, 웹 역 인덱스 생성물을 함께 갱신했다.
manifest dataVersion/해시가 바뀌지만 데이터 내용은 동일하다.
기존 HEAD와 `json.loads` 후 비교한 12개 데이터 JSON은 동일했다(SEO pairs의 dataVersion만 제외).
manifest의 차이는 files receipt, dataVersion, previousDataVersion, generatedAt이다.
레지스트리 전체 내용 및 `(code, addedIn)` 목록이 동일하고, od.bin은 바이트까지 동일하다.
최초 실행은 이 worktree에 없던 원본을 내려받았으며 모든 원본 SHA-256이 기존 receipt와 일치했다.
커밋에는 기존 fetch receipt 시각을 유지하고 형식만 정리했다.
반복 `data:refresh` 전후 data 전체와 웹 역 인덱스 33개 파일의 SHA-256을 비교해 모두 동일함을 확인했다.

## 검증

- 기존 구현에서 이름 벡터·문장 테스트 2건 실패 확인 후 수정하여 통과.
- JSON 출력 테스트: 중첩 객체 정렬, 배열 순서, 들여쓰기·끝 줄바꿈, 입력 키 순서와 공백이 달라도 출력 바이트 동일.
- dispatcher 테스트: 파일 IO가 주입한 StandardTestDispatcher의 scheduler 실행 전에는 완료되지 않고 실행 후 완료됨.
- `./gradlew ktlintFormat check integrationTest`: 성공. JVM test 165, KMP jvmTest 144, integrationTest 32; 실패·오류·스킵 0.
- `mise run data:refresh`: 성공, 반복 실행 시 모든 출력 바이트 동일, Artifacts unchanged.

기존 T1에 기록한 schema serialization 타입 분석 진단 12건은 그대로이며 컴파일·검사는 통과한다.
결정 필요: 없음. CI 결과와 최종 계약 생성 검증은 PR에 기록한다.
