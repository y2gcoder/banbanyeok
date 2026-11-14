/**
 * PostHog SDK가 이벤트마다 자동으로 붙이는 속성(`$current_url`, `$referrer` 등)을 보내기 직전에 정리한다(before_send).
 * 공유 링크의 URL 쿼리에는 출발역 코드와 이름이 들어 있으므로 쿼리·해시는 어떤 속성에도 남기지 않는다.
 */
import type { CaptureResult } from "posthog-js";

/** URL·경로가 담긴 속성 이름(`$current_url`, `$session_entry_url`, `$referrer`, `$pathname`, `$session_entry_pathname` …). */
const URL_PROPERTY = /(url|href|referrer|pathname)/i;

/** SEO 조합 페이지 경로 `/meet/<역코드>-<역코드>`: 역 코드를 속성에 남기지 않도록 자리표시로 바꾼다. */
const PAIR_PATH = /\/meet\/[0-9a-z]{3}-[0-9a-z]{3}(?=\/|$)/g;

function stripQueryAndHash(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/)[0] ?? "";
  }
}

/** 쿼리·해시를 떼고 조합 페이지 경로의 역 코드를 가린다. 주소로 읽히지 않는 값(`$direct`, `/s?o=…`)도 같은 규칙을 쓴다. */
export function redactUrl(value: string): string {
  return stripQueryAndHash(value).replace(PAIR_PATH, "/meet/[pair]");
}

function redactBag(bag: Record<string, unknown> | undefined): void {
  if (!bag) return;
  for (const [name, value] of Object.entries(bag)) {
    if (typeof value === "string" && URL_PROPERTY.test(name)) bag[name] = redactUrl(value);
  }
}

/**
 * - URL류 속성에서 쿼리·해시 제거(properties, $set, $set_once).
 * - `$geoip_disable`: 위치(GeoIP) 보강을 끈다. 클라이언트 IP는 SDK가 아니라 서버가 요청에서 읽으므로 저장 방지는
 *   PostHog 프로젝트 설정 "Discard client IP data"가 한다(docs/setup/p7-notes.md).
 */
export function redactCapture(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null;
  redactBag(result.properties);
  redactBag(result.$set);
  redactBag(result.$set_once);
  result.properties = { ...result.properties, $geoip_disable: true };
  return result;
}
