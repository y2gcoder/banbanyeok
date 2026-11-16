/**
 * 줄바꿈 검사(브라우저 안에서 실행하는 순수 함수라 `page.evaluate`에도, iOS 시뮬레이터 스크립트(scripts/ios-sim-line-break.ts)가
 * 페이지에 넣는 코드(`fn.toString()`)로도 쓴다). 바깥 변수·import를 쓰지 않는다. 설명은 docs/setup/w2-paren-notes.md.
 */

/**
 * 여는 괄호 "(" 바로 뒤에서 줄이 바뀐 곳(그 앞뒤 글자). `(`와 다음 글자가 같은 글자 마디 안에 있을 때 둘의 줄(y)을 비교한다.
 * 글꼴이 불러와진 뒤에 불러야 한다. 빈 배열이면 통과다.
 */
export function orphanedOpenParens(rootSelector: string): string[] {
  const root = document.querySelector(rootSelector);
  if (!root) return [`root not found: ${rootSelector}`];
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, noscript, [aria-hidden=true]")) continue;
    for (let i = text.indexOf("("); i !== -1 && i < text.length - 1; i = text.indexOf("(", i + 1)) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const open = range.getClientRects()[0];
      range.setStart(node, i + 1);
      range.setEnd(node, i + 2);
      const next = range.getClientRects()[0];
      if (open && next && open.width > 0 && next.width > 0 && next.top - open.top > open.height / 2) {
        found.push(text.slice(Math.max(0, i - 8), i + 8));
      }
    }
  }
  return found;
}

/**
 * 괄호 묶음 보호(`parenSafe`, src/lib/text/paren-safe.tsx) 밖에 있는 "("(앞뒤 글자). 줄 끝에 있는 "(" 뒤에 요소가 이어지는
 * 경우(글자가 없는 끝)는 묶을 수 없으므로 세지 않는다. 브라우저와 무관하게 구조로 확인한다.
 */
export function unguardedOpenParens(rootSelector: string): string[] {
  const root = document.querySelector(rootSelector);
  if (!root) return [`root not found: ${rootSelector}`];
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, noscript, [aria-hidden=true], [data-paren-safe]")) continue;
    for (let i = text.indexOf("("); i !== -1 && i < text.length - 1; i = text.indexOf("(", i + 1)) {
      found.push(text.slice(Math.max(0, i - 8), i + 8));
    }
  }
  return found;
}
