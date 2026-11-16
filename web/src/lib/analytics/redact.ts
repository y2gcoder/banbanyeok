/**
 * PostHog SDK가 이벤트마다 자동으로 붙이는 속성(`$current_url`, `$referrer` 등)을 보내기 직전에 정리한다(before_send).
 * 공유 링크의 URL 쿼리에는 출발역 코드와 이름이 들어 있으므로 쿼리·해시는 어떤 속성에도 남기지 않는다.
 *
 * SDK가 스스로 만드는 이벤트는 계약(contracts/events.json `sdkEvents`)의 `$exception`(오류)·`$web_vitals`(속도 수치)만 보내고
 * 그 밖의 `$` 이벤트는 버린다. 이 두 이벤트는 오류 메시지·스택(파일 경로·함수 이름)·중첩 객체 안의 주소까지 모든 문자열을
 * [redactText]로 가린다: 주소의 쿼리·해시, 방 경로의 방 ID, 역 조합 경로의 역 코드, Bearer 토큰, 토큰 모양 문자열,
 * 그리고 이 기기가 아는 방 ID·토큰([CaptureContext.secrets]).
 */
import type { CaptureResult } from "posthog-js";
import { SDK_EVENT_NAMES } from "./events.gen";

/** URL·경로가 담긴 속성 이름(`$current_url`, `$session_entry_url`, `$referrer`, `$pathname`, `$session_entry_pathname` …). */
const URL_PROPERTY = /(url|href|referrer|pathname)/i;

/** SEO 조합 페이지 경로 `/meet/<역코드>-<역코드>`: 역 코드를 속성에 남기지 않도록 자리표시로 바꾼다. */
const PAIR_PATH = /\/meet\/[0-9a-z]{3}-[0-9a-z]{3}(?![0-9a-z-])/gi;

/** 방 경로 `/r/<방 ID 10자>`: 방 ID는 방 링크 그 자체(방을 보고 참여할 수 있는 권한)라서 속성에 남기지 않는다. `/r/new`는 그대로 둔다. */
const ROOM_PATH = /\/r\/[0-9a-z]{10}(?![0-9a-z])/gi;

/** 글 안의 절대 주소(스킴://…). 괄호·따옴표·공백에서 끝난다(스택 줄 "at f (https://…/a.js:1:2)"). */
const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}]+/gi;

/** 글 안의 상대 경로 뒤 쿼리·해시("/s?o=…", "/result?v=2&o=…#x"). 앞 글자가 공백이 아닐 때만(문장의 "?"·"#1"은 둔다). */
const TRAILING_QUERY = /(\S)[?#][^\s"'`<>()[\]{}]+/g;

/** `Authorization: Bearer <토큰>` 꼴. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** 방장·참여자 토큰 모양(base64url 32바이트 = 43자). 서버가 만드는 토큰과 같은 길이의 덩어리를 가린다. */
const TOKEN_SHAPE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/** 가릴 값의 최소 길이. 너무 짧은 값(역 코드 3자 등)은 다른 글자를 망가뜨리므로 주소 규칙으로만 가린다. */
const MIN_SECRET_LENGTH = 8;

/** 중첩 객체를 따라 들어가는 최대 깊이(스택 프레임 등). 더 깊은 값은 통째로 버린다. */
const MAX_DEPTH = 8;

const SDK_EVENTS: readonly string[] = SDK_EVENT_NAMES;

export type CaptureContext = {
  /** 이 기기가 아는 방 ID·토큰(보고 있는 방, 저장된 방 기록). 오류·속도 이벤트의 모든 문자열에서 가린다. */
  secrets: () => readonly string[];
  /** 우리 이벤트와 같은 공통 속성(platform·app_version·data_version). SDK 자동 이벤트에도 붙여 같은 기준으로 나눠 본다. */
  common?: () => object;
  /** false면 아무것도 보내지 않는다(동의 철회 뒤 SDK에 남은 처리기가 만든 이벤트). 없으면 보낸다. */
  active?: () => boolean;
};

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

/** 쿼리·해시를 떼고 조합 페이지 경로의 역 코드와 방 경로의 방 ID를 가린다. 주소로 읽히지 않는 값(`$direct`, `/s?o=…`)도 같은 규칙을 쓴다. */
export function redactUrl(value: string): string {
  return stripQueryAndHash(value).replace(PAIR_PATH, "/meet/[pair]").replace(ROOM_PATH, "/r/[room]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 자유 글(오류 메시지, 스택, 파일 경로)에서 개인정보가 될 수 있는 부분을 가린다. 주소는 [redactUrl]과 같은 규칙이고,
 * 그 밖에 Bearer 토큰·토큰 모양 문자열·[secrets](이 기기가 아는 방 ID·토큰, 대소문자 무시)를 지운다.
 */
export function redactText(value: string, secrets: readonly string[] = []): string {
  let text = value
    .replace(ABSOLUTE_URL, (url) => redactUrl(url))
    .replace(TRAILING_QUERY, "$1")
    .replace(PAIR_PATH, "/meet/[pair]")
    .replace(ROOM_PATH, "/r/[room]")
    .replace(BEARER, "Bearer [token]")
    .replace(TOKEN_SHAPE, "[token]");
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    text = text.replace(new RegExp(escapeRegExp(secret), "gi"), "[redacted]");
  }
  return text;
}

/** 모든 문자열을 [redactText]로 가린 새 값. 객체·배열은 따라 들어가고, 너무 깊으면 버린다. */
function redactDeep(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, secrets, depth + 1);
  return out;
}

function redactBag(bag: Record<string, unknown> | undefined): void {
  if (!bag) return;
  for (const [name, value] of Object.entries(bag)) {
    if (typeof value === "string" && URL_PROPERTY.test(name)) bag[name] = redactUrl(value);
  }
}

/**
 * before_send. 순서:
 * 0. 동의가 철회됐으면([CaptureContext.active]) 버린다.
 * 1. SDK가 스스로 만든 `$` 이벤트 중 계약의 `sdkEvents`(`$exception`, `$web_vitals`)가 아니면 버린다(null).
 * 2. URL류 속성에서 쿼리·해시 제거, 방 ID·역 조합 가림(properties, $set, $set_once).
 * 3. `$exception`·`$web_vitals`는 모든 문자열(중첩 포함)을 [redactText]로 가리고 공통 속성(platform 등)을 붙인다.
 * 4. `$geoip_disable`: 위치(GeoIP) 보강을 끈다. 클라이언트 IP는 SDK가 아니라 서버가 요청에서 읽으므로 저장 방지는
 *    PostHog 프로젝트 설정 "Discard client IP data"가 한다(docs/setup/p7-notes.md).
 */
export function redactCapture(result: CaptureResult | null, context?: CaptureContext): CaptureResult | null {
  if (!result || context?.active?.() === false) return null;
  const event = result.event;
  if (event.startsWith("$") && !SDK_EVENTS.includes(event)) return null;
  redactBag(result.properties);
  redactBag(result.$set);
  redactBag(result.$set_once);
  if (SDK_EVENTS.includes(event)) {
    const secrets = context?.secrets() ?? [];
    const redacted = redactDeep(result.properties, secrets) as CaptureResult["properties"];
    result.properties = { ...redacted, ...context?.common?.() };
  }
  result.properties = { ...result.properties, $geoip_disable: true };
  return result;
}
