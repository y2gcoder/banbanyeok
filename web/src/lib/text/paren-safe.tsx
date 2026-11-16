import { Fragment, type ReactNode } from "react";

/**
 * iOS Safari(WebKit)는 `word-break: keep-all`일 때 여는 괄호 "(" 바로 뒤에서도 줄을 바꾼다("…회사 (⏎7항)"). 데스크톱 WebKit·Chromium은
 * 그러지 않고, 바꿀 수 있는 CSS(line-break·overflow-wrap·lang·U+2060 등)도 없다(docs/setup/w2-paren-notes.md). `(`부터 다음 공백 앞까지
 * (괄호 묶음이 붙은 말마디)를 인라인 블록 하나로 묶어, 그 안에서는 줄을 바꾸지 않고 통째로 다음 줄로 넘기게 한다.
 *
 * - 말마디(공백 사이 덩어리)를 통째로 묶고 중간을 자르지 않는다: 낭독·복사·찾기는 그대로다.
 * - 짧은 덩어리(24자 이하)는 인라인 `whitespace-nowrap`: 인라인이라 접근성 이름·낭독에 공백이 끼지 않는다(inline-block은 Chromium이
 *   이름 계산에서 앞뒤에 공백을 넣는다).
 * - 긴 덩어리(주소 등)는 `inline-block max-w-full`·`word-break: normal`: 블록 안에서 일반 규칙으로 접히므로 가로로 넘치지 않는다
 *   (nowrap으로 묶으면 긴 주소가 화면 밖으로 넘친다).
 * - 문자열에서만 동작한다. 링크 같은 요소가 괄호 안에 섞이면 그 경계는 묶지 못한다.
 */
const PAREN_WORD = /\([^\s]*/gu;

/** 이 길이까지는 인라인 nowrap(접근성 이름에 공백이 끼지 않는다). 넘으면(주소 등) 블록으로 묶어 접히게 한다. */
const NOWRAP_MAX = 24;

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
        className={match[0].length <= NOWRAP_MAX ? "whitespace-nowrap" : "inline-block max-w-full [word-break:normal]"}
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
