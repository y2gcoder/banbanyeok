/**
 * 서브셋 글꼴에 있는 글자(`og-glyphs.gen.json`, `pnpm gen:og-font`이 글꼴과 함께 만든다)와 그 밖의 글자 처리.
 * 글꼴에 없는 글자를 그대로 그리면 빈 네모(□)가 나온다. 이미지에는 사용자가 쓴 별칭이 들어가므로 그리기 전에 거른다.
 */
import raw from "./og-glyphs.gen.json";
import { OG_NAME_MAX, OG_TEXT } from "./og-text";

const covered = new Set<string>(Array.from(raw.chars));

function isCovered(char: string): boolean {
  return covered.has(char);
}

/**
 * 글꼴에 없는 글자를 뺀 문자열(공백은 하나로). 남는 글자가 없으면 `fallback`.
 * 이모지·한자 등은 빠지고 "지훈🎂"은 "지훈"이 된다. `OG_NAME_MAX`를 넘으면 가운데를 말줄임표로 줄이고 끝을 남긴다. 끝을 자르면 앞이 같은
 * 두 별칭("…막내민지"·"…막내민수")이나 같은 역에서 오는 두 사람("동대문역사문화공원 1"·"… 2")이 그림에서 같은 이름이 된다.
 * 서버가 같은 이름에 붙인 번호(" 2", contracts/data-format.md §8, 인원이 4명까지라 한두 자리)는 길이에서 빼고 센다.
 */
export function ogSafeName(text: string, fallback: string): string {
  const kept = Array.from(text)
    .filter((ch) => isCovered(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (kept === "") return fallback;
  const numbered = /^(.+) (\d{1,2})$/.exec(kept);
  const base = Array.from(numbered?.[1] ?? kept);
  if (base.length <= OG_NAME_MAX) return kept;
  const chars = Array.from(kept);
  const tail = numbered ? Array.from(numbered[2] ?? "").length + 2 : 2;
  return `${chars
    .slice(0, OG_NAME_MAX - tail)
    .join("")
    .trimEnd()}${OG_TEXT.ellipsis}${chars.slice(-tail).join("")}`;
}

/** 글꼴 필터나 폭 맞춤으로 같아진 이름은 참가 순번으로 구별한다.
 * 원래 별칭이 대체 이름("참가자 1")과 겹치는 경우에도 같은 번호 체계를 적용한다. */
export function distinctNames(names: string[]): string[] {
  const ordinal = (i: number) => `참가자 ${i + 1}`;
  const result = names.map((name, i) => (names.indexOf(name) === names.lastIndexOf(name) ? name : ordinal(i)));
  return new Set(result).size === result.length ? result : names.map((_, i) => ordinal(i));
}

export function ogParticipantNames(labels: string[]): string[] {
  return distinctNames(labels.map((label, i) => ogSafeName(label, `참가자 ${i + 1}`)));
}

/** 역 이름 같은 신뢰하는 문자열이 글꼴에 다 있는지(없는 글자 목록). 테스트와 빌드 점검용. */
export function missingGlyphs(text: string): string[] {
  return [...new Set(Array.from(text).filter((ch) => !isCovered(ch)))];
}
