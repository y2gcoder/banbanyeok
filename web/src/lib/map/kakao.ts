/**
 * 카카오맵 웹 대중교통 길찾기 링크(공식: Kakao 지도 Web API 가이드 "길찾기 바로가기").
 * `https://map.kakao.com/link/by/traffic/{이름},{위도},{경도}/{이름},{위도},{경도}`
 * 형식·인코딩은 shared/links `KakaoMapLinks`와 같다: 이름은 unreserved 외 전부 퍼센트 인코딩, 좌표는 소수 6자리 고정.
 * 앱 스킴은 공식 문서가 없어(p6-notes 3절) 웹 링크만 쓴다.
 */
export type MapPlace = { name: string; lat: number; lng: number };

function percentEncode(text: string): string {
  // encodeURIComponent는 !'()*도 남기므로 RFC 3986 unreserved(A-Za-z0-9-._~) 외에는 모두 인코딩한다.
  return encodeURIComponent(text).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function coordinate(value: number, limit: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw new RangeError(`좌표가 올바르지 않습니다: ${value}`);
  // shared/links Coordinate.format과 같은 반올림(절댓값 기준 half-up). toFixed의 이진 반올림 차이를 피한다.
  const scaled = Math.floor(Math.abs(value) * 1_000_000 + 0.5);
  const sign = value < 0 && scaled !== 0 ? "-" : "";
  return `${sign}${Math.floor(scaled / 1_000_000)}.${String(scaled % 1_000_000).padStart(6, "0")}`;
}

function segment(place: MapPlace): string {
  if (!place.name.trim()) throw new RangeError("장소 이름이 비어 있습니다");
  return `${percentEncode(place.name)},${coordinate(place.lat, 90)},${coordinate(place.lng, 180)}`;
}

export function kakaoTransitUrl(from: MapPlace, to: MapPlace): string {
  return `https://map.kakao.com/link/by/traffic/${segment(from)}/${segment(to)}`;
}

/** 도착지만 아는 경우(출발역이 숨겨진 경우 등): 장소 보기 링크. */
export function kakaoPlaceUrl(place: MapPlace): string {
  return `https://map.kakao.com/link/map/${segment(place)}`;
}
