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
 * 이모지·한자 등은 빠지고 "지훈🎂"은 "지훈"이 된다. `OG_NAME_MAX`를 넘으면 자르고 말줄임표를 붙인다.
 */
export function ogSafeName(text: string, fallback: string): string {
  const kept = Array.from(text)
    .filter((ch) => isCovered(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (kept === "") return fallback;
  const chars = Array.from(kept);
  return chars.length > OG_NAME_MAX ? `${chars.slice(0, OG_NAME_MAX).join("")}${OG_TEXT.ellipsis}` : kept;
}

/** 역 이름 같은 신뢰하는 문자열이 글꼴에 다 있는지(없는 글자 목록). 테스트와 빌드 점검용. */
export function missingGlyphs(text: string): string[] {
  return [...new Set(Array.from(text).filter((ch) => !isCovered(ch)))];
}
