import { Fragment, type ReactNode } from "react";

/**
 * iOS Safari(WebKit)는 `word-break: keep-all`일 때 여는 괄호 "(" 바로 뒤에서도 줄을 바꾼다("…회사 (⏎7항)"). 여는 꺾쇠 「도 같다
 * ("개인정보보호위원회 「⏎개인정보 …"). 데스크톱 WebKit·Chromium은 그러지 않고, 바꿀 수 있는 CSS(line-break·overflow-wrap·lang·U+2060 등)도
 * 없다(docs/setup/w2-paren-notes.md). 여는 괄호류(OPEN_BRACKETS: ( 「 『 （ ［ 등)가 든 말마디 전체(공백 사이 덩어리, 예
 * "서울(asia-northeast3)", "(7항).", "「개인정보")를 span 하나로 묶어, 그 안에서는 줄을 바꾸지 않고 통째로 다음 줄로 넘긴다.
 *
 * - 말마디를 통째로 묶고 단어 중간을 자르지 않는다: 낭독·복사·찾기·접근성 이름이 그대로다(예전 "(" 부터 묶는 방식은 "서울"+"(…)"로 쪼갰다).
 * - 모두 인라인이다(inline-block은 Chromium이 접근성 이름에 앞뒤 공백을 넣는다).
 * - 짧은 말마디(너비 점수 NOWRAP_MAX 이하; 한글·전각 2, 그 밖 1)는 `whitespace-nowrap`.
 * - 긴 말마디(주소 등)는 `[word-break:normal]`만 준다: nowrap으로 묶으면 주소가 화면 밖으로 넘친다.
 * - 문자열에서만 동작한다. 링크 같은 요소가 괄호 안에 섞이면 그 경계는 묶지 못한다.
 */
const OPEN_BRACKETS = "(「『（［【〈《〔｛";
const PAREN_WORD = new RegExp(`\\S*[${OPEN_BRACKETS}]\\S*`, "gu");

/** 이 너비 점수까지는 nowrap. 좁은 칸(320px의 스위치 라벨 약 176px)에서도 안 넘치게 한글 약 8자 / 영문 약 16자로 둔다. */
const NOWRAP_MAX = 16;

/** 대략의 너비 점수: 한글·전각 2, 반각 1. */
const width = (word: string) => [...word].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1), 0);

/** 표 칸처럼 값이 없을 수 있는 자리(noUncheckedIndexedAccess)를 위해 `undefined`도 받는다. */
export function parenSafe(text: string | undefined): ReactNode {
  if (text === undefined) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(PAREN_WORD)) {
    if (match.index > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, match.index)}</Fragment>);
    parts.push(
      <span
        key={`p${match.index}`}
        data-paren-safe=""
        className={width(match[0]) <= NOWRAP_MAX ? "whitespace-nowrap" : "[word-break:normal]"}
      >
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return parts;
}
