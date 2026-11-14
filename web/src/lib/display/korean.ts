/**
 * 조사 선택. shared/app-logic `Korean.attach`와 같은 규칙: 마지막으로 **읽히는** 글자(한글·영문·숫자)의 받침으로 고르고,
 * 끝의 기호·이모지는 건너뛴다. 영문 L·M·N·R, 숫자 0·1·3·6·7·8은 받침이 있다.
 * (es-hangul의 josa는 영문·숫자 이름을 다르게 읽어 공유 모듈과 어긋나므로 쓰지 않는다.)
 */
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

export type Josa = "은/는" | "이/가" | "과/와";

function hasFinalConsonant(word: string): boolean {
  const chars = [...word];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const ch = chars[i] ?? "";
    const code = ch.codePointAt(0) ?? 0;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) return (code - HANGUL_BASE) % 28 !== 0;
    if (/^[A-Za-z]$/.test(ch)) return "LMNR".includes(ch.toUpperCase());
    if (/^[0-9]$/.test(ch)) return "013678".includes(ch);
  }
  return false;
}

export function withJosa(word: string, josa: Josa): string {
  const [withFinal, withoutFinal] = josa.split("/") as [string, string];
  return word + (hasFinalConsonant(word) ? withFinal : withoutFinal);
}

/** "합정" → "합정역", "서울역" → "서울역". */
export function stationLabel(name: string): string {
  return name.endsWith("역") ? name : `${name}역`;
}
