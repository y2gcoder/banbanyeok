import type { Page } from "@playwright/test";

/**
 * 배치 검사(브라우저 안에서 계산). 각 함수는 문제 목록을 돌려주고, 빈 배열이면 통과다.
 * 화면 밖에 숨긴 요소(sr-only 등 1px 이하)와 보이지 않는 요소는 보지 않는다.
 */

/** 가로 넘침: 문서 폭이 화면보다 넓으면, 화면 오른쪽 밖으로 나간 요소를 함께 알려 준다. */
export function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const width = window.innerWidth;
    if (doc.scrollWidth <= width) return [];
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.right > width + 1;
      })
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}`,
      );
    return [`scrollWidth ${doc.scrollWidth} > innerWidth ${width}`, ...offenders];
  });
}

const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=combobox]";

/**
 * 겹침: 누를 수 있는 것·제목·본문 글이 서로 겹치는지. 한쪽이 다른 쪽을 품은 경우(버튼 안 글자)와
 * 입력 칸 안에 일부러 넣은 지우기 버튼은 겹침이 아니다.
 */
export function overlaps(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    // checkVisibility는 접힌 <details> 안(content-visibility: hidden)과 투명·숨김 요소를 보이지 않는 것으로 친다.
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    // [data-paren-safe]는 문장 속 글자 묶음(여러 줄로 접히면 사각형이 이웃과 겹쳐 보인다)이라 따로 재지 않는다.
    const nodes = [
      ...document.querySelectorAll(`${selector}, h1, h2, h3, p, li > span:not([data-paren-safe]), dt, dd`),
    ].filter((el) => visible(el) && !el.closest("[data-layout-overlay]"));
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}「${(el.textContent ?? (el as HTMLInputElement).placeholder ?? "").trim().slice(0, 18)}」`;
    const problems: string[] = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i] as Element;
      const ra = a.getBoundingClientRect();
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j] as Element;
        if (a.contains(b) || b.contains(a)) continue;
        const group = a.closest("[data-slot=combobox-input-group]");
        if (group && group === b.closest("[data-slot=combobox-input-group]")) continue;
        const rb = b.getBoundingClientRect();
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 2 && y > 2) problems.push(`${name(a)} ⟷ ${name(b)} (${Math.round(x)}×${Math.round(y)})`);
      }
    }
    return problems.slice(0, 10);
  }, INTERACTIVE);
}

/** 잘림: 글자가 상자보다 넓어 잘리는 버튼·링크·제목(말줄임 `truncate`를 일부러 쓴 곳은 뺀다). */
export function clippedText(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll<HTMLElement>(`${selector}, h1, h2, h3`)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        if (getComputedStyle(el).textOverflow === "ellipsis") return false;
        return el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
      })
      .slice(0, 10)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}「${(el.textContent ?? "").trim().slice(0, 20)}」 ${el.scrollWidth}>${el.clientWidth}`,
      );
  }, INTERACTIVE);
}

/**
 * 터치 목표: 누를 수 있는 것은 44×44 CSS px 이상(task 원칙 5, Apple HIG·WCAG 2.5.5).
 * 문장 안의 글자 링크(WCAG 2.5.5 inline 예외)와 화면에 보이지 않는 실제 입력(체크박스·라디오는 감싼 레이블 전체가 목표)은 뺀다.
 */
export function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const targetOf = (el: HTMLElement): HTMLElement => {
      const input = el as HTMLInputElement;
      if (el.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")) {
        return (el.closest("label") ??
          (input.id ? document.querySelector(`label[for="${input.id}"]`) : null) ??
          el) as HTMLElement;
      }
      return el;
    };
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        if (el.tagName === "A" && el.closest("p, li > p, dd")) return false; // 문장 안 링크
        const t = targetOf(el).getBoundingClientRect();
        return t.height < 43.5 || t.width < 43.5;
      })
      .map((el) => {
        const t = targetOf(el).getBoundingClientRect();
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 18);
        return `${el.tagName.toLowerCase()}「${label}」 ${Math.round(t.width)}×${Math.round(t.height)}`;
      });
  }, INTERACTIVE);
}

/** iOS 사파리는 글자가 16px보다 작은 입력 칸에 초점이 가면 화면을 확대한다. */
export function smallInputFonts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]), select, textarea")]
      .filter((el) => el.getBoundingClientRect().width > 1 && Number.parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}#${el.id} ${getComputedStyle(el).fontSize}`),
  );
}
