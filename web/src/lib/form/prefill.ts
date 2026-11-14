/**
 * 입력 화면 미리 채우기: `/?o=<역 코드>.<역 코드>`. SEO 페이지의 "다른 역으로 다시 찾기"가 이 주소로 보낸다.
 * `/s` 링크와 같은 코드 규칙(점으로 이은 3자 코드)을 쓰되 모드·별칭은 없다. 알 수 없거나 계산할 수 없는 코드는 건너뛴다.
 */
import { isStationCode, MAX_PEOPLE } from "@/lib/link/codec";
import { type Station, stationByCode } from "@/lib/stations";

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
