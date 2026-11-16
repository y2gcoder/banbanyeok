import type { ReactNode } from "react";

/** 여는 괄호와 그 바로 뒤 글자 하나. 둘을 한 덩어리로 묶어 여는 괄호가 줄 끝에 혼자 남지 않게 한다. */
const OPENING_CHUNK = /\(\S/gu;

/**
 * 한글 문장에서 여는 괄호가 줄 끝에 혼자 남는 줄바꿈("쓰는지(⏎기능별", "입니다(⏎7항)")을 막는다.
 * 여는 괄호와 그 바로 뒤 글자 하나를 줄바꿈 없는 한 덩어리로 묶는다. 두 글자뿐이라 좁은 화면에서도 가로로 넘치지 않는다.
 * 글자는 하나도 바꾸지 않는다(텍스트 내용·읽는 소리 그대로).
 */
export function keepParens(text: string): ReactNode {
  if (!text.includes("(")) return text;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(OPENING_CHUNK)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <span key={match.index} className="whitespace-nowrap">
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
