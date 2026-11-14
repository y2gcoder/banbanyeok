/**
 * 공유 URL `/s` 링크 코덱. 규칙 원본은 contracts/data-format.md §7, 일치 기준은
 * contracts/golden/link-vectors.json(기준 구현 prototype/gen_link_vectors.py)이다.
 * 웹은 KMP를 쓰지 않으므로 같은 규칙을 TypeScript로 따로 구현한다.
 */
import type { Mode } from "@/lib/api/types";

const URL_VERSION = "1";
export const MIN_PEOPLE = 2;
export const MAX_PEOPLE = 4;
export const MAX_NICKNAME_CODE_POINTS = 20;

const STATION_CODE = /^[0-9a-hjkmnp-tv-z]{3}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export type LinkErrorCode =
  | "MALFORMED_QUERY"
  | "MISSING_PARAM"
  | "DUPLICATE_PARAM"
  | "UNSUPPORTED_VERSION"
  | "BAD_ORIGIN_COUNT"
  | "BAD_STATION_CODE"
  | "BAD_MODE"
  | "FAVOR_INDEX_OUT_OF_RANGE"
  | "BAD_NICKNAMES";

/** 링크가 담는 상태. `favorIndex`는 mode가 favor일 때만 숫자다. 별칭이 없으면 `nicknames`는 null. */
export type ShareState = {
  origins: string[];
  mode: Mode;
  favorIndex: number | null;
  nicknames: (string | null)[] | null;
};

export type DecodeResult = { ok: true; state: ShareState } | { ok: false; error: LinkErrorCode };

export function isStationCode(text: string): boolean {
  return STATION_CODE.test(text);
}

/** 코드포인트 수(UTF-16 길이가 아니다). 이모지 하나는 1. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function base64UrlEncode(text: string): string {
  let binary = "";
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(segment: string): string | null {
  if (!BASE64URL.test(segment) || segment.length % 4 === 1) return null;
  let text: string;
  try {
    const padded = segment.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    const binary = atob(padded);
    text = strictDecoder.decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
  } catch {
    return null;
  }
  // 남는 비트가 0이 아닌 비정규 base64를 거부한다.
  return base64UrlEncode(text) === segment ? text : null;
}

/** 모드 → `m` 값. favor인데 위치가 없거나 범위 밖이면 RangeError. */
export function modeToParam(mode: Mode, favorIndex: number | null, count: number): string {
  switch (mode) {
    case "fair":
      return "f";
    case "fast":
      return "q";
    case "favor":
      if (favorIndex === null || favorIndex < 0 || favorIndex >= count) throw new RangeError("favorIndex");
      return `p${favorIndex}`;
  }
}

/** `m` 값 → 모드. 규칙에 맞지 않으면 null(화면은 공평으로 되돌린다). */
export function modeFromParam(m: string, count: number): Pick<ShareState, "mode" | "favorIndex"> | null {
  try {
    return readMode(m, count);
  } catch {
    return null;
  }
}

/** 정규형 쿼리(앞의 `?` 없음). 순서 v, o, m, n. 별칭이 하나도 없으면 n을 생략한다. 규칙 위반은 RangeError. */
export function encodeShareQuery(state: ShareState): string {
  const { origins, nicknames } = state;
  if (origins.length < MIN_PEOPLE || origins.length > MAX_PEOPLE || !origins.every(isStationCode)) {
    throw new RangeError("origins");
  }
  const parts = [
    `v=${URL_VERSION}`,
    `o=${origins.join(".")}`,
    `m=${modeToParam(state.mode, state.favorIndex, origins.length)}`,
  ];
  if (nicknames?.some((name) => name)) {
    if (nicknames.length !== origins.length) throw new RangeError("nicknames");
    for (const name of nicknames) {
      if (name && codePointLength(name) > MAX_NICKNAME_CODE_POINTS) throw new RangeError("nickname length");
    }
    parts.push(`n=${nicknames.map((name) => base64UrlEncode(name ?? "")).join(".")}`);
  }
  return parts.join("&");
}

class LinkError extends Error {
  constructor(readonly code: LinkErrorCode) {
    super(code);
  }
}

function percentDecode(raw: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(raw)) throw new LinkError("MALFORMED_QUERY");
  try {
    // decodeURIComponent는 잘못된 UTF-8도 URIError로 거부한다. `+`는 공백으로 바꾸지 않는다(규칙과 같음).
    return decodeURIComponent(raw);
  } catch {
    throw new LinkError("MALFORMED_QUERY");
  }
}

function readParams(query: string): Map<string, string> {
  const values = new Map<string, string>();
  const body = query.startsWith("?") ? query.slice(1) : query;
  for (const pair of body ? body.split("&") : []) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (key !== "v" && key !== "o" && key !== "m" && key !== "n") continue; // 알 수 없는 키는 무시
    if (values.has(key)) throw new LinkError("DUPLICATE_PARAM");
    values.set(key, percentDecode(eq < 0 ? "" : pair.slice(eq + 1)));
  }
  return values;
}

function readMode(m: string, count: number): Pick<ShareState, "mode" | "favorIndex"> {
  if (m === "f") return { mode: "fair", favorIndex: null };
  if (m === "q") return { mode: "fast", favorIndex: null };
  const match = /^p([0-3])$/.exec(m);
  if (!match?.[1]) throw new LinkError("BAD_MODE");
  const favorIndex = Number(match[1]);
  if (favorIndex >= count) throw new LinkError("FAVOR_INDEX_OUT_OF_RANGE");
  return { mode: "favor", favorIndex };
}

function readNicknames(n: string | undefined, count: number): (string | null)[] | null {
  if (n === undefined) return null;
  const segments = n.split(".");
  if (segments.length !== count) throw new LinkError("BAD_NICKNAMES");
  const names = segments.map((segment) => {
    const text = segment ? base64UrlDecode(segment) : "";
    if (text === null || codePointLength(text) > MAX_NICKNAME_CODE_POINTS) throw new LinkError("BAD_NICKNAMES");
    return text || null;
  });
  if (!names.some((name) => name)) throw new LinkError("BAD_NICKNAMES"); // 정규형은 별칭이 없으면 n을 생략한다
  return names;
}

/** 쿼리 문자열(앞의 `?`는 있어도 된다)을 해석한다. 오류는 검사 순서 v→o→m→n의 첫 번째 하나만. */
export function decodeShareQuery(query: string): DecodeResult {
  try {
    const values = readParams(query);
    const v = values.get("v");
    const o = values.get("o");
    const m = values.get("m");
    if (v === undefined || o === undefined || m === undefined) throw new LinkError("MISSING_PARAM");
    if (v !== URL_VERSION) throw new LinkError("UNSUPPORTED_VERSION");
    const origins = o.split(".");
    if (origins.length < MIN_PEOPLE || origins.length > MAX_PEOPLE) throw new LinkError("BAD_ORIGIN_COUNT");
    if (!origins.every(isStationCode)) throw new LinkError("BAD_STATION_CODE");
    const mode = readMode(m, origins.length);
    return { ok: true, state: { origins, ...mode, nicknames: readNicknames(values.get("n"), origins.length) } };
  } catch (error) {
    if (error instanceof LinkError) return { ok: false, error: error.code };
    throw error;
  }
}
