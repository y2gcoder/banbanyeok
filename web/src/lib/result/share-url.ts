import { encodeShareQuery, type ShareState } from "@/lib/link/codec";

/** 받는 사람이 여는 링크(`/s`). 결과 화면(`/result`)과 같은 쿼리를 쓴다. */
export function sharePath(state: ShareState): string {
  return `/s?${encodeShareQuery(state)}`;
}

export function resultPath(state: ShareState): string {
  return `/result?${encodeShareQuery(state)}`;
}

/** 서버 컴포넌트의 searchParams를 원래 쿼리 문자열로 되돌린다(디코더가 퍼센트 디코딩을 직접 한다). */
export function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      parts.push(`${key}=${encodeURIComponent(item)}`);
    }
  }
  return parts.join("&");
}
