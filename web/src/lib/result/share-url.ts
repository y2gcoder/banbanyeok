import { SHARED_OG_IMAGE_VERSION } from "@/lib/copy/og-text";
import { encodeShareQuery, type ShareState } from "@/lib/link/codec";

const SHARED_OG_PATH = "/s/og";

/** 받는 사람이 여는 링크(`/s`). 결과 화면(`/result`)과 같은 쿼리를 쓴다. */
export function sharePath(state: ShareState): string {
  return `/s?${encodeShareQuery(state)}`;
}

/**
 * `og:image` 주소. 데이터 버전(`dv`)을 붙여, 새 데이터가 나오면 주소가 바뀌어 크롤러 캐시를 비켜 간다. 그림 디자인 버전(`iv`,
 * `SHARED_OG_IMAGE_VERSION`)도 붙여, 그림이 바뀌면 같은 결과도 새 주소가 된다(카카오는 그림을 주소별로 오래 캐시하고 지울 길이 없다).
 * 링크 자신의 버전 `v`(1·2)와 다른 값이다.
 */
export function sharedImagePath(state: ShareState, dataVersion: string): string {
  return `${SHARED_OG_PATH}?${encodeShareQuery(state)}&dv=${encodeURIComponent(dataVersion)}&iv=${SHARED_OG_IMAGE_VERSION}`;
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
