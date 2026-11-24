/**
 * 방 공유 링크와 그 미리보기 그림 주소. 카카오톡은 미리보기를 링크 주소마다 오래(약 100일) 캐시하고 지울 수 없어서, 공유할 때마다
 * 방의 공유 번호(`Room.shareVersion`, 서버가 올리고 줄지 않는 번호)를 붙인다. 내용 해시를 쓰지 않는다: 방이 예전 상태로 돌아오면 주소도
 * 예전과 같아져 그때 캐시된 미리보기가 다시 뜬다(#51). `v`(공유 링크 코덱)와 `dv`(역 데이터 버전)는 이미 쓰는 이름이라 `sv`다.
 * 번호 옆에 보이는 범위 정책 버전(`pv`, `ROOM_SHARE_POLICY_VERSION`)도 붙인다: 방 내용이 그대로여도 서버가 남에게 보이는 값을 바꾸면
 * (#142: 숨긴 사람의 시간) 다시 공유하는 링크가 새 주소가 되어 옛 미리보기를 캐시에서 받지 않는다. 이미 퍼진 옛 주소의 캐시는 지울 수 없다.
 */
import { ROOM_OG_IMAGE_VERSION, ROOM_SHARE_POLICY_VERSION } from "@/lib/copy/og-text";
import { roomPath } from "./id";

export const SHARE_VERSION_PARAM = "sv";
const DATA_VERSION_PARAM = "dv";
const IMAGE_VERSION_PARAM = "iv";
const POLICY_VERSION_PARAM = "pv";

/** "0"이나 0으로 시작하지 않는 십진수만. "012", "1e3", "-1", "+1", " 1"은 번호가 아니다. */
const CANONICAL_NUMBER = /^(?:0|[1-9][0-9]*)$/;

/**
 * `/r/<id>?sv=<n>&pv=<정책 버전>`. 번호를 모르면(번호를 보내지 않는 옛 서버) 얇은 `/r/<id>`(방 내용이 없는 기본 미리보기라 정책과 무관하다).
 * 방 화면은 `pv`를 읽지 않는다(주소를 가르는 값일 뿐이다). [policyVersion]은 테스트가 다른 정책의 주소를 견줄 때만 넘긴다.
 */
export function roomShareLink(
  roomId: string,
  shareVersion: number | undefined,
  policyVersion: number = ROOM_SHARE_POLICY_VERSION,
): string {
  return shareVersion === undefined
    ? roomPath(roomId)
    : `${roomPath(roomId)}?${SHARE_VERSION_PARAM}=${shareVersion}&${POLICY_VERSION_PARAM}=${policyVersion}`;
}

/**
 * 방 링크의 `og:image`: `/r/<id>/og?sv=<n>&dv=<데이터 버전>&pv=<정책 버전>&iv=<그림 버전>`. 그림 경로는 `sv`·`dv`가 지금 값과 같을 때만 방 카드를 그린다.
 * `iv`(`ROOM_OG_IMAGE_VERSION`)는 캐시를 비켜 가는 값이다: 그리는 코드·문구가 바뀌면 방 내용이 그대로여도(`sv`가 같아도) 주소가 달라져,
 * 다시 공유한 메시지가 캐시된 옛 그림을 받지 않는다. 그림 경로는 `iv`를 검사하지 않는다(배포 전에 열어 둔 화면이 보낸 옛 `iv` 주소도
 * 지금 그림을 받는 편이 기본 그림보다 낫다). `pv`(보이는 범위 정책)도 같은 이유로 붙이고 검사하지 않는다.
 */
export function roomImagePath(
  roomId: string,
  shareVersion: number,
  dataVersion: string,
  policyVersion: number = ROOM_SHARE_POLICY_VERSION,
): string {
  return `${roomPath(roomId)}/og?${SHARE_VERSION_PARAM}=${shareVersion}&${DATA_VERSION_PARAM}=${encodeURIComponent(dataVersion)}&${POLICY_VERSION_PARAM}=${policyVersion}&${IMAGE_VERSION_PARAM}=${ROOM_OG_IMAGE_VERSION}`;
}

/** 주소의 `sv` 값. 하나뿐인 0 이상의 안전한 정수만 번호이고, 없거나 그 밖이면 null(얇은 기본 미리보기). */
export function parseShareVersion(raw: string | string[] | null | undefined): number | null {
  if (typeof raw !== "string" || !CANONICAL_NUMBER.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseDataVersion(search: URLSearchParams): string | null {
  return search.get(DATA_VERSION_PARAM) || null;
}
