/**
 * 방 공유 링크와 그 미리보기 그림 주소. 카카오톡은 미리보기를 링크 주소마다 오래(약 100일) 캐시하고 지울 수 없어서, 공유할 때마다
 * 방의 공유 번호(`Room.shareVersion`, 서버가 올리고 줄지 않는 번호)를 붙인다. 내용 해시를 쓰지 않는다: 방이 예전 상태로 돌아오면 주소도
 * 예전과 같아져 그때 캐시된 미리보기가 다시 뜬다(#51). `v`(공유 링크 코덱)와 `dv`(역 데이터 버전)는 이미 쓰는 이름이라 `sv`다.
 */
import { roomPath } from "./id";

export const SHARE_VERSION_PARAM = "sv";
const DATA_VERSION_PARAM = "dv";

/** "0"이나 0으로 시작하지 않는 십진수만. "012", "1e3", "-1", "+1", " 1"은 번호가 아니다. */
const CANONICAL_NUMBER = /^(?:0|[1-9][0-9]*)$/;

/** `/r/<id>?sv=<n>`. 번호를 모르면(번호를 보내지 않는 옛 서버) 얇은 `/r/<id>`. */
export function roomShareLink(roomId: string, shareVersion: number | undefined): string {
  return shareVersion === undefined ? roomPath(roomId) : `${roomPath(roomId)}?${SHARE_VERSION_PARAM}=${shareVersion}`;
}

/** 방 링크의 `og:image`: `/r/<id>/og?sv=<n>&dv=<데이터 버전>`. 그림 경로는 둘이 지금 값과 같을 때만 방 카드를 그린다. */
export function roomImagePath(roomId: string, shareVersion: number, dataVersion: string): string {
  return `${roomPath(roomId)}/og?${SHARE_VERSION_PARAM}=${shareVersion}&${DATA_VERSION_PARAM}=${encodeURIComponent(dataVersion)}`;
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
