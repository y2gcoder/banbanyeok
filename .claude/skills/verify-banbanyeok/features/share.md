# 공유(링크·카톡)

결과 화면에서 "링크 복사"나 "카톡으로 보내기"로 결과를 친구에게 보낸다. 받은 사람은 `/s?…` 링크를 열어 "친구가 보낸 만날 역 후보"를 보고, '나는 누구?'에서 자기를 고르면 그 사람 줄에 `(나)`가 붙는다. 공유 링크는 결과를 주소에 담으므로 DB에 쓰지 않는다. 방의 링크 공유는 `features/room-join.md`에 있다.

## Sub-features

- `share-copy` 결과 화면의 "링크 복사"가 `/s?v=2&o=…&m=f&t=…` 링크를 클립보드에 넣는다.
- `share-open` 받은 링크에서 `heading "친구가 보낸 만날 역 후보"`가 보인다.
- `share-me` '나는 누구?'에서 고르면 주소에 `me=<번호>`가 붙고 그 사람 줄에 `(나)`가 붙는다.
- `share-kakao` "카톡으로 보내기" 버튼이 보인다. 키가 있는 배포에서만 카카오톡 공유 API로 보낸다.

## How to get to it (user POV)

- 첫 화면의 "모두 입력" 탭에서 결과를 만든 뒤 결과 화면의 "카톡으로 보내기"나 "링크 복사"를 누른다.
- 친구는 메신저로 받은 `/s?…` 링크를 연다.

## Driving it with verify.sh

Preconditions:

- 기본 전제를 만족한다.
- `verify.sh drive share-link phone`(바꾼 화면이면 `desktop`도)으로 돌린다.

- **결과 만들기.** 첫 화면에서 `tab "모두 입력"`을 누르고 강남·홍대입구를 골라 `button "만날 역 찾기"`를 누른다. 1위 `article`과 `button "카톡으로 보내기"`가 보인다.
- **링크 복사.** `button "링크 복사"`를 누르고 클립보드를 읽는다. `/s?v=2&o=k3a.ryf&m=f&t=…` 꼴이다(`shared-link.txt`).
- **받은 링크 열기.** `newPerson()`의 화면으로 링크를 연다. `heading "친구가 보낸 만날 역 후보"`가 보인다.
- **나 고르기.** `group "나는 누구?"` 안의 `button "홍대입구"`(exact)를 누른다. 주소에 `me=1`이 붙고 1위 카드에 `홍대입구(나)`가 보인다.
- **증거.** `db-rooms-before.tsv`와 `db-rooms-after.tsv`의 방 수가 같다. `03-friend-picks-self.png`에 `(나)` 표시가 있다.

## Gotchas

- `verify.sh launch`는 카카오 키(`NEXT_PUBLIC_KAKAO_JS_KEY`)를 넣지 않는다. 키가 없으면 "카톡으로 보내기"는 시스템 공유 시트로 떨어진다. 카톡 전송은 이 스킬로 증명할 수 없으니 보고에 '건너뜀: 키 없음'이라 적는다.
- 클립보드를 읽으려면 컨텍스트에 `clipboard-read` 권한이 있어야 한다. `drive.mjs`가 준다.
- 만든 사람 화면에는 `(나)`가 없는 것이 정상이다. `(나)`는 받은 사람이 고른 뒤에만 붙는다.
