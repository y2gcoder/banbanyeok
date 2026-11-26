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

function glyphsOnly(text: string): string {
  return Array.from(text)
    .filter((ch) => isCovered(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 이름을 `OG_NAME_MAX`자(서버가 같은 이름에 붙인 번호 " 2"는 빼고 센다, contracts/data-format.md §8, 인원이 4명까지라 한두 자리)
 * 안으로 줄인다. 넘으면 가운데를 말줄임표로 줄이고 끝을 남긴다: 끝을 자르면 앞이 같은 두 별칭("…막내민지"·"…막내민수")이나 같은 역에서
 * 오는 두 사람("동대문역사문화공원 1"·"… 2")이 같은 이름이 된다. `from`이 줄여서 안 보이는 자리면 그 글자부터 보이게 줄인다
 * ("우리회사서울영업일팀민지" → "…일팀민지"). 결과는 늘 말줄임표 포함 `OG_NAME_MAX + 1`자 이하다.
 */
function shortenName(name: string, from: number): string {
  const numbered = /^(.+) (\d{1,2})$/.exec(name);
  if (Array.from(numbered?.[1] ?? name).length <= OG_NAME_MAX) return name;
  const chars = Array.from(name);
  const tailLength = numbered ? Array.from(numbered[2] ?? "").length + 2 : 2;
  const head = OG_NAME_MAX - tailLength;
  const tail = chars.slice(-tailLength).join("");
  if (from < head || from >= chars.length - tailLength) {
    return `${chars.slice(0, head).join("").trimEnd()}${OG_TEXT.ellipsis}${tail}`;
  }
  if (chars.length - from <= OG_NAME_MAX) return `${OG_TEXT.ellipsis}${chars.slice(from).join("")}`;
  return `${OG_TEXT.ellipsis}${chars.slice(from, from + head - 1).join("")}${OG_TEXT.ellipsis}${tail}`;
}

/**
 * 글꼴에 없는 글자를 뺀 문자열(공백은 하나로)을 `OG_NAME_MAX`자 안으로 줄인 것. 남는 글자가 없으면 `fallback`.
 * 이모지·한자 등은 빠지고 "지훈🎂"은 "지훈"이 된다.
 */
export function ogSafeName(text: string, fallback: string): string {
  const kept = glyphsOnly(text);
  return kept === "" ? fallback : shortenName(kept, 0);
}

/** 이름을 줄이는 방법. `from`은 보이게 남길 첫 글자(코드 포인트 위치)다. 0이면 평소대로 줄인다. */
export type Shorten = (name: string, index: number, from: number) => string;

const isDistinct = (names: string[]) => new Set(names).size === names.length;

function sharedPrefixLength(names: string[]): number {
  const [first = [], ...rest] = names.map((name) => Array.from(name));
  let length = 0;
  while (length < first.length && rest.every((chars) => chars[length] === first[length])) length += 1;
  return length;
}

/**
 * 줄인 이름이 겹치면 원래 이름에서 처음 갈리는 글자부터 보이게 다시 줄인다("우리회사서울영업일팀민지"·"…이팀민지" → "…일팀민지"·"…이팀민지").
 * 줄인 이름은 사람이 앱에서 보는 이름의 일부라 누구인지 이어 볼 수 있다. 원래 이름까지 같으면(글꼴에 없는 글자만 다른 "지훈🎂"·"지훈🎉")
 * 서버가 같은 이름에 하듯 겹친 사람끼리 목록 순서로 " 1"·" 2"를 붙인다. 그래도 겹치는 드문 경우는 모두에게 목록 순번을 붙인다.
 */
export function distinctNames(full: string[], shorten: Shorten): string[] {
  const plain = full.map((name, i) => shorten(name, i, 0));
  if (isDistinct(plain)) return plain;
  const split = plain.map((short, i) => {
    const group = full.filter((_, j) => plain[j] === short);
    return group.length > 1 ? shorten(full[i] ?? "", i, sharedPrefixLength(group)) : short;
  });
  if (isDistinct(split)) return split;
  const numbered = split.map((short, i) => {
    const same = split.flatMap((other, j) => (other === short ? [j] : []));
    return same.length > 1 ? shorten(`${full[i] ?? ""} ${same.indexOf(i) + 1}`, i, 0) : short;
  });
  return isDistinct(numbered) ? numbered : full.map((name, i) => shorten(`${name} ${i + 1}`, i, 0));
}

/** 그림에 그릴 사람 이름들. 남는 글자가 없는 이름(이모지만)은 순번("참가자 N")이다. 서로 다른 사람은 다른 이름으로 남는다. */
export function ogParticipantNames(labels: string[]): string[] {
  const kept = labels.map((label, i) => glyphsOnly(label) || `참가자 ${i + 1}`);
  return distinctNames(kept, (name, _i, from) => shortenName(name, from));
}

/** 역 이름 같은 신뢰하는 문자열이 글꼴에 다 있는지(없는 글자 목록). 테스트와 빌드 점검용. */
export function missingGlyphs(text: string): string[] {
  return [...new Set(Array.from(text).filter((ch) => !isCovered(ch)))];
}
