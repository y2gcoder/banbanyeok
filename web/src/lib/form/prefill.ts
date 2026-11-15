/**
 * 입력 화면 미리 채우기: `/?o=<역 코드>.<역 코드>`. SEO 페이지의 "다른 역으로 다시 찾기"가 이 주소로 보낸다.
 * `/s` 링크와 같은 코드 규칙(점으로 이은 3자 코드)을 쓰되 모드·별칭은 없다. 알 수 없거나 계산할 수 없는 코드는 건너뛴다.
 */
import type { Mode } from "@/lib/api/types";
import { decodeShareQuery, encodeShareQuery, isStationCode, MAX_PEOPLE, type ShareState } from "@/lib/link/codec";
import { type Station, stationByCode } from "@/lib/stations";
import type { TimeSlot } from "@/lib/when/time-slot";

export function prefillHref(codes: readonly string[]): string {
  return `/?o=${codes.join(".")}`;
}

/** 쿼리 문자열(앞의 `?`는 있어도 된다)에서 미리 채울 역을 순서대로. */
export function parsePrefill(search: string): Station[] {
  const value = new URLSearchParams(search).get("o");
  if (!value) return [];
  const stations: Station[] = [];
  for (const code of value.split(".").slice(0, MAX_PEOPLE)) {
    const station = isStationCode(code) ? stationByCode(code) : undefined;
    if (station?.supported) stations.push(station);
  }
  return stations;
}

/**
 * 결과 화면의 "다시 입력"이 가는 주소: 결과 링크와 같은 쿼리(`/?v=2&o=…&m=…&t=…&n=…`). 출발역·이름·모드·구분을 그대로 싣는다.
 * 기기에 저장하지 않고 주소에만 담으므로 "나" 한 칸만 기억하는 저장소와 무관하게 모든 줄이 돌아온다.
 */
export function restoreHref(state: ShareState): string {
  return `/?${encodeShareQuery(state)}`;
}

/** 다시 입력으로 돌아온 한 줄. 역을 알 수 없거나 계산할 수 없으면 `station`이 null(줄 자리는 그대로 둔다). */
type RestoredRow = { nickname: string; station: Station | null; favored: boolean };
export type Restored = { rows: RestoredRow[]; slot: TimeSlot; mode: Mode };

/** `restoreHref`가 만든 쿼리를 읽는다. 결과 링크 규칙에 맞지 않으면 null(그때는 `parsePrefill`로 넘어간다). */
export function parseRestore(search: string): Restored | null {
  const decoded = decodeShareQuery(search);
  if (!decoded.ok) return null;
  const { origins, nicknames, timeSlot, mode, favorIndex } = decoded.state;
  const rows = origins.map((code, index) => {
    const station = stationByCode(code);
    return {
      nickname: nicknames?.[index] ?? "",
      station: station?.supported ? station : null,
      favored: mode === "favor" && favorIndex === index,
    };
  });
  return { rows, slot: timeSlot, mode };
}
