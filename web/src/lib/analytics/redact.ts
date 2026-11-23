/**
 * PostHog SDK가 이벤트마다 자동으로 붙이는 속성(`$current_url`, `$referrer` 등)을 보내기 직전에 정리한다(before_send).
 * 공유 링크의 URL 쿼리에는 출발역 코드와 이름이 들어 있으므로 쿼리·해시는 어떤 속성에도 남기지 않는다.
 *
 * SDK가 주소에서 뽑아 따로 붙이는 유입 태그(`utm_*`, 광고 클릭 ID, 검색어 `ph_keyword`와 그 `$session_entry_*`·`$initial_*`판)는
 * 쿼리를 지워도 남으므로 속성째 지운다([isCampaignProperty]). 공유 링크에 `utm_term=<별명>`을 붙여 열어도 별명이 나가지 않는다(#116 검토).
 *
 * SDK가 스스로 만드는 이벤트는 계약(contracts/events.json `sdkEvents`)의 `$exception`(오류)·`$web_vitals`(속도 수치)만 보내고
 * 그 밖의 `$` 이벤트는 버린다. 이 두 이벤트는 오류 메시지·스택(파일 경로·함수 이름)·중첩 객체 안의 주소까지 모든 문자열을
 * [redactText]로 가린다: 주소의 쿼리·해시, 방 경로의 방 ID, 역 조합 경로의 역 코드, Bearer 토큰, 토큰 모양 문자열,
 * 그리고 이 기기가 아는 방 ID·토큰([CaptureContext.secrets]). 오류 메시지는 그다음 형식만 남긴다([maskMessage]): 흔한 오류 문구의
 * 영어 낱말·가린 주소·문장부호만 두고 나머지 낱말(한글, 숫자, 역 코드, 따옴표 안의 값 등)은 `…`로 바꾼다. 메시지에 입력값이 섞여도
 * 출발역·이름이 나가지 않는다.
 */
import type { CaptureResult } from "posthog-js";
import { SDK_EVENT_NAMES } from "./events.gen";

/** URL·경로가 담긴 속성 이름(`$current_url`, `$session_entry_url`, `$referrer`, `$pathname`, `$session_entry_pathname` …). */
const URL_PROPERTY = /(url|href|referrer|pathname)/i;

/** SEO 조합 페이지 경로 `/meet/<역코드>-<역코드>`: 역 코드를 속성에 남기지 않도록 자리표시로 바꾼다. */
const PAIR_PATH = /\/meet\/[0-9a-z]{3}-[0-9a-z]{3}(?![0-9a-z-])/gi;

/** 방 경로 `/r/<방 ID 10자>`: 방 ID는 방 링크 그 자체(방을 보고 참여할 수 있는 권한)라서 속성에 남기지 않는다. `/r/new`는 그대로 둔다. */
const ROOM_PATH = /\/r\/[0-9a-z]{10}(?![0-9a-z])/gi;

/** 방 API 경로 `/rooms/<방 ID 10자>`(`/api/v1/rooms/…`, 오류 메시지·요청 주소에 나온다). */
const ROOM_API_PATH = /\/rooms\/[0-9a-z]{10}(?![0-9a-z])/gi;

/** 글 안의 절대 주소(스킴://…). 괄호·따옴표·공백에서 끝난다(스택 줄 "at f (https://…/a.js:1:2)"). */
const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}]+/gi;

/** 글 안의 상대 경로 뒤 쿼리·해시("/s?o=…", "/result?v=2&o=…#x"). 앞 글자가 공백이 아닐 때만(문장의 "?"·"#1"은 둔다). */
const TRAILING_QUERY = /(\S)[?#][^\s"'`<>()[\]{}]+/g;

/** `Authorization: Bearer <토큰>` 꼴. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** 방장·참여자 토큰 모양(base64url 32바이트 = 43자). 서버가 만드는 토큰과 같은 길이의 덩어리를 가린다. */
const TOKEN_SHAPE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/**
 * SDK가 주소의 쿼리에서 따로 뽑아 속성으로 붙이는 유입 태그 이름(posthog-js 1.447.3, `@posthog/browser-common`
 * event-utils의 CAMPAIGN_PARAMS·PERSONAL_DATA_CAMPAIGN_PARAMS)과 검색어(`ph_keyword`), 광고 쿠키(`$fbc`·`$fbp`).
 * 값은 링크를 만든 사람이 마음대로 넣는 글이라(예: `utm_term=<별명>`) 어떤 판(`$session_entry_*`, `$initial_*`)도 보내지 않는다.
 * `utm_`으로 시작하는 이름은 목록에 없어도 지운다(SDK가 늘려도 빠지지 않게).
 */
const CAMPAIGN_PARAMS: ReadonlySet<string> = new Set([
  "gad_source",
  "mc_cid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "igshid",
  "ttclid",
  "rdt_cid",
  "epik",
  "qclid",
  "sccid",
  "oppref",
  "bfcid",
  "irclid",
  "_kx",
  "ph_keyword",
  "fbc",
  "fbp",
]);

/** 유입 태그 속성인지. `$session_entry_`·`$initial_`·`$` 접두를 뗀 이름으로 본다. */
export function isCampaignProperty(name: string): boolean {
  const base = name.replace(/^\$(?:session_entry_|initial_)?/, "").toLowerCase();
  return base.startsWith("utm_") || CAMPAIGN_PARAMS.has(base);
}

/**
 * 오류 메시지에 남겨 두는 낱말: 브라우저·React·Next.js의 흔한 오류 문구에 나오는 영어 낱말뿐이다(소문자로 비교).
 * 역 코드(3자)와 겹치는 낱말은 넣지 않는다(redact.test.ts가 역 목록과 대조한다). 이 목록에 없는 낱말은 `…`가 된다.
 */
export const MESSAGE_WORDS: ReadonlySet<string> = new Set(
  `a an the is are was were be been being not no nor of to in on at as by or but if for from with without into
  than then this that it its has have had can cannot could would should will may might must do does did done
  null undefined nan infinity true false object objects function functions array string number boolean symbol bigint
  class constructor prototype instance method property properties value values key keys item element elements node
  nodes child parent document window navigator global reading setting read set get define defined assign assignment
  assigned access call called invoke iterable iterator length index range invalid valid unexpected expected token end
  input json position line column syntax error errors exception failed fail failure fetch load loading loaded network
  request response status aborted abort timeout timed out operation user signal reason chunk module script resource
  import importing dynamically imported minified react visit full message hydration mismatch text content server
  client rendered render rendering initial match tree maximum stack size exceeded recursion too much many permission
  denied allowed quota storage security cross origin blocked insecure context convert primitive type received
  argument arguments parameter missing required unknown unsupported supported feature browser promise rejected
  rejection unhandled captured non before after initialization declared variable constant observer resizeobserver
  loop completed undelivered notifications execute when attempting use dev environment additional helpful warnings
  because`
    .split(/\s+/)
    .filter(Boolean),
);

/** 메시지 안에서 그대로 둘 덩어리: 가린 주소(redactText를 거친 뒤)와 자리표시([room]·[pair]·[token]·[redacted]). */
const KEEP_IN_MESSAGE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()[\]{}]+|\[(?:room|pair|token|redacted)\]/giu;

/** 낱말 하나(글자·숫자·밑줄). 한글·숫자·역 코드도 낱말이다. */
const MESSAGE_WORD = /[\p{L}\p{M}\p{N}_$]+/gu;

/** 가린 낱말이 문장부호만 사이에 두고 이어지면 하나로 합친다(`k3a.ryf` → `…`). */
const MASK_RUN = /…(?:[\s.,:;_/+-]*…)+/gu;

/**
 * 오류 메시지의 형식만 남긴다: [MESSAGE_WORDS]의 낱말, 가린 주소·자리표시, 문장부호·공백만 두고 나머지 낱말은 `…`로 바꾼다.
 * 예: `Unexpected token '검', "검토별명" is not valid JSON` → `Unexpected token '…', "…" is not valid JSON`.
 */
export function maskMessage(value: string): string {
  const maskWords = (text: string) =>
    text.replace(MESSAGE_WORD, (word) => (MESSAGE_WORDS.has(word.toLowerCase()) ? word : "…"));
  let out = "";
  let last = 0;
  for (const match of value.matchAll(KEEP_IN_MESSAGE)) {
    out += maskWords(value.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return (out + maskWords(value.slice(last))).replace(MASK_RUN, "…");
}

/** 오류 종류(`TypeError` 등): 코드의 식별자 모양만 두고 그 밖은 `Error`로 바꾼다. */
function maskErrorType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[A-Za-z_$][\w$]{0,63}$/.test(value) ? value : "Error";
}

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
  return stripQueryAndHash(value)
    .replace(PAIR_PATH, "/meet/[pair]")
    .replace(ROOM_PATH, "/r/[room]")
    .replace(ROOM_API_PATH, "/rooms/[room]");
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
    .replace(ROOM_API_PATH, "/rooms/[room]")
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
  // 키도 가린다(SDK가 주소·메시지를 키로 쓰는 경우가 있어도 남지 않게).
  for (const [key, item] of Object.entries(value)) out[redactText(key, secrets)] = redactDeep(item, secrets, depth + 1);
  return out;
}

function redactBag(bag: Record<string, unknown> | undefined): void {
  if (!bag) return;
  for (const [name, value] of Object.entries(bag)) {
    if (isCampaignProperty(name)) delete bag[name];
    else if (typeof value === "string" && URL_PROPERTY.test(name)) bag[name] = redactUrl(value);
  }
}

/**
 * `$exception`의 메시지·종류에서 자유 글을 뺀다(redactDeep 뒤). 메시지는 [maskMessage], 종류는 식별자 모양만.
 * 오류 직전 단계 기록(`$exception_steps`, 앱이 쓰지 않는 기능)은 통째로 버린다.
 */
function maskException(properties: Record<string, unknown>): void {
  delete properties.$exception_steps;
  if (typeof properties.$exception_message === "string") {
    properties.$exception_message = maskMessage(properties.$exception_message);
  }
  if ("$exception_type" in properties) properties.$exception_type = maskErrorType(properties.$exception_type);
  if (Array.isArray(properties.$exception_values)) {
    properties.$exception_values = properties.$exception_values.map((v) =>
      typeof v === "string" ? maskMessage(v) : v,
    );
  }
  if (Array.isArray(properties.$exception_types)) {
    properties.$exception_types = properties.$exception_types.map(maskErrorType);
  }
  if (Array.isArray(properties.$exception_list)) {
    for (const item of properties.$exception_list) {
      if (item === null || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.value === "string") entry.value = maskMessage(entry.value);
      if ("type" in entry) entry.type = maskErrorType(entry.type);
    }
  }
}

/**
 * before_send. 순서:
 * 0. 동의가 철회됐으면([CaptureContext.active]) 버린다.
 * 1. SDK가 스스로 만든 `$` 이벤트 중 계약의 `sdkEvents`(`$exception`, `$web_vitals`)가 아니면 버린다(null).
 * 2. 유입 태그 속성 삭제([isCampaignProperty]), URL류 속성에서 쿼리·해시 제거, 방 ID·역 조합 가림(properties, $set, $set_once).
 * 3. `$exception`·`$web_vitals`는 모든 문자열(중첩 포함)을 [redactText]로 가리고 공통 속성(platform 등)을 붙인다.
 *    `$exception`은 메시지의 형식만 남긴다([maskMessage]).
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
    if (event === "$exception") maskException(redacted);
    result.properties = { ...redacted, ...context?.common?.() };
  }
  result.properties = { ...result.properties, $geoip_disable: true };
  return result;
}
