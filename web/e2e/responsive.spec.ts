import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkLayout, expectColumns, isWide } from "./support/checks";
import { horizontalOverflow } from "./support/layout";
import { prepareRoom, type RoomScenario } from "./support/room-fixture";
import { SHOT_IDS, SHOT_SCREENS, VIEWPORTS, type ViewportCase } from "./support/viewports";

/**
 * 반응형 행렬(U1, docs/setup/u1-notes.md): 모든 화면 × 기기 폭·높이에서 가로 넘침·주요 버튼·겹침·잘림(터치 기기는 44px 목표·16px 입력)과
 * 두 칸 배치 여부를 확인한다. 이어서 접힘↔펼침 전환, 데스크톱 키보드, 큰 기본 글자, 경첩(Viewport Segments)을 따로 본다.
 * UPDATE_SCREENSHOTS=1이면 docs/setup/u1-screens/<기기>/<화면>.png를 남긴다(SHOTS_DIR로 폴더를 바꿀 수 있다: 전후 비교용).
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup", process.env.SHOTS_DIR ?? "u1-screens");

type Screen = {
  id: string;
  path: string;
  room?: RoomScenario;
  /** 화면이 다 그려졌다는 표시. */
  ready: (page: Page) => Locator;
  /** 보이고 눌려야 하는 주요 버튼·링크. */
  actions: (page: Page) => Locator[];
  /** 두 칸 폭에서 나란히(좁으면 위아래) 놓여야 하는 왼쪽·오른쪽 칸의 대표 요소. */
  columns?: (page: Page) => [Locator, Locator];
};

// 사람 3명(강남·홍대입구·신촌), 이름은 "민수", 없음, 긴 이름(20자 한도 안).
const RESULT_QUERY = "v=1&o=k3a.ryf.1qs&m=f&n=66-87IiY..7KeA7Jew7J207JmA7ZWo6ruY7Jik64qU6ri07J2066aE";

const SCREENS: readonly Screen[] = [
  {
    id: "home",
    path: "/",
    ready: (p) => p.getByRole("heading", { name: /딱 반반일까/ }),
    actions: (p) => [
      p.getByRole("combobox").first(),
      p.getByRole("button", { name: /한 명 더/ }),
      p.getByRole("link", { name: /방 만들어서 각자 입력하기/ }),
    ],
    columns: (p) => [p.getByRole("heading", { name: /딱 반반일까/ }), p.getByRole("combobox").first()],
  },
  {
    id: "result",
    path: `/result?${RESULT_QUERY}`,
    ready: (p) => p.getByRole("article").first(),
    actions: (p) => [
      p.getByRole("tab", { name: "빨리 만나기" }),
      p.getByRole("button", { name: "이 역으로 정했어요" }).first(),
      p.getByRole("button", { name: "카톡으로 보내기" }),
    ],
    columns: (p) => [p.getByRole("tablist"), p.getByRole("article").first()],
  },
  {
    id: "shared",
    path: `/s?${RESULT_QUERY}`,
    ready: (p) => p.getByRole("article").first(),
    actions: (p) => [
      p.getByRole("group", { name: "나는 누구?" }).getByRole("button").first(),
      p.getByRole("tab", { name: "빨리 만나기" }),
      p.getByRole("link", { name: "나도 다른 조합으로 찾아보기" }),
    ],
    columns: (p) => [p.getByRole("group", { name: "나는 누구?" }), p.getByRole("article").first()],
  },
  {
    id: "room-new",
    path: "/r/new",
    ready: (p) => p.getByRole("heading", { name: /방 만들기/ }),
    actions: (p) => [p.getByRole("combobox", { name: "내 출발역" }), p.getByText("빨리 만나기", { exact: true })],
    columns: (p) => [p.getByRole("heading", { name: /방 만들기/ }), p.getByRole("combobox", { name: "내 출발역" })],
  },
  {
    id: "room-host-alone",
    path: "",
    room: "host-alone",
    ready: (p) => p.getByRole("heading", { name: "친구에게 링크를 보내 주세요" }),
    actions: (p) => [p.getByRole("button", { name: "카톡으로 보내기" }), p.getByRole("button", { name: "링크 복사" })],
    columns: (p) => [
      p.getByRole("region", { name: "들어온 사람" }),
      p.getByText("두 명 이상 들어오면 결과를 볼 수 있어요."),
    ],
  },
  {
    id: "room-friend-join",
    path: "",
    room: "friend-join",
    ready: (p) => p.getByRole("article").first(),
    actions: (p) => [
      p.getByRole("combobox", { name: "내 출발역" }),
      p.getByRole("tab", { name: "빨리 만나기" }),
      p.getByRole("button", { name: "이 역으로 정했어요" }).first(),
    ],
    columns: (p) => [p.getByRole("form", { name: "나도 출발역 넣기" }), p.getByRole("article").first()],
  },
  {
    id: "room-host-full",
    path: "",
    room: "host-full",
    ready: (p) => p.getByRole("article").first(),
    actions: (p) => [
      p.getByRole("button", { name: "카톡으로 보내기" }),
      p.getByRole("button", { name: "참여 잠그기" }),
      p.getByRole("button", { name: "방 삭제 방 전체" }),
    ],
    columns: (p) => [p.getByRole("region", { name: "들어온 사람" }), p.getByRole("article").first()],
  },
  {
    id: "meet",
    path: "/meet",
    ready: (p) => p.getByRole("heading", { name: "인기 역 조합별 만날 곳" }),
    actions: (p) => [p.getByRole("link", { name: "다른 역으로 직접 찾아보기" })],
    columns: (p) => [p.getByRole("region").nth(0), p.getByRole("region").nth(1)],
  },
  {
    id: "meet-pair",
    path: "/meet/1qs-2je",
    ready: (p) => p.getByRole("heading", { level: 1 }),
    actions: (p) => [p.getByRole("link", { name: "다른 역으로 다시 찾기" })],
    // 두 칸 폭에서는 1위가 한 줄을 쓰고 2·3위가 나란히 온다.
    columns: (p) => [
      p.getByRole("list", { name: "추천 후보" }).getByRole("article").nth(1),
      p.getByRole("list", { name: "추천 후보" }).getByRole("article").nth(2),
    ],
  },
  {
    id: "privacy",
    path: "/privacy",
    ready: (p) => p.getByRole("heading", { name: "개인정보 처리방침", level: 1 }),
    actions: (p) => [p.getByRole("navigation", { name: "목차" }).getByRole("link").first()],
  },
  {
    id: "not-found",
    path: "/no-such-page",
    ready: (p) => p.getByRole("heading", { name: "없는 페이지예요" }),
    actions: (p) => [p.getByRole("link", { name: "만날 역 찾기로 가기" })],
  },
];

const screen = (id: string): Screen => {
  const found = SCREENS.find((s) => s.id === id);
  if (!found) throw new Error(id);
  return found;
};

async function open(page: Page, s: Screen) {
  const path = s.room ? await prepareRoom(page, s.room) : s.path;
  await page.goto(path);
  await expect(s.ready(page)).toBeVisible();
  // 글꼴(동적 서브셋)이 다 들어온 뒤 잰다. 글꼴이 바뀌면 줄바꿈이 달라진다.
  await page.evaluate(() => document.fonts.ready);
}

async function shot(page: Page, vp: ViewportCase, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS || !SHOT_IDS.has(vp.id) || !SHOT_SCREENS.has(name)) return;
  mkdirSync(resolve(shotsDir, vp.id), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  // CSS px 1:1로 저장한다(기기 픽셀 비율만큼 키우면 저장소가 커진다).
  await page.screenshot({
    path: resolve(shotsDir, vp.id, `${name}.png`),
    fullPage: true,
    animations: "disabled",
    scale: "css",
  });
}

const useViewport = (vp: ViewportCase) =>
  test.use({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.touch,
    hasTouch: vp.touch,
    deviceScaleFactor: vp.scale ?? (vp.touch ? 2 : 1),
  });

for (const vp of VIEWPORTS) {
  test.describe(`${vp.id} (${vp.label} ${vp.width}×${vp.height})`, () => {
    useViewport(vp);
    for (const s of SCREENS) {
      test(s.id, async ({ page }) => {
        await open(page, s);
        await shot(page, vp, s.id);
        await checkLayout(page, s.actions(page), vp.touch);
        if (s.columns) await expectColumns(page, ...s.columns(page));
      });
    }
  });
}

/** 접힌 커버 화면(Galaxy Z Fold7 커버)과 펼친 화면(Galaxy Z Fold7). */
const FOLDED = { width: 360, height: 764 };
const UNFOLDED = { width: 984, height: 1016 };

async function pickStation(page: Page, field: Locator, query: string, option: RegExp) {
  await field.fill(query);
  await page.getByRole("option", { name: option }).click();
}

test.describe("접힘 ↔ 펼침 전환: 실행 중에 화면 크기가 바뀌어도 상태와 배치가 유지된다", () => {
  test.use({ viewport: FOLDED, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("입력 화면: 입력값·추가한 줄이 남고, 펼치면 두 칸·접으면 한 칸", async ({ page }) => {
    await open(page, screen("home"));
    await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
    await pickStation(page, page.getByRole("combobox", { name: "민수의 출발역" }), "강남", /^강남\s?2호선/);
    await page.getByRole("button", { name: /한 명 더/ }).click();
    await page.getByRole("textbox", { name: "3번째 사람 이름(선택)" }).fill("지연");

    for (const size of [UNFOLDED, FOLDED, UNFOLDED]) {
      await page.setViewportSize(size);
      await expect(page.getByRole("textbox", { name: "1번째 사람 이름(선택)" })).toHaveValue("민수");
      await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("강남");
      await expect(page.getByRole("textbox", { name: "3번째 사람 이름(선택)" })).toHaveValue("지연");
      expect(await horizontalOverflow(page)).toEqual([]);
      await expectColumns(page, page.getByRole("heading", { name: /딱 반반일까/ }), page.getByRole("combobox").first());
    }
    expect(await isWide(page)).toBe(true);

    // 펼친 채로 이어서 입력하고 제출할 수 있다.
    await pickStation(page, page.getByRole("combobox", { name: "친구1의 출발역" }), "홍대입구", /^홍대입구\s?2호선/);
    await page.getByRole("button", { name: "만날 역 찾기" }).click();
    await expect(page).toHaveURL(
      /\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=(?:weekday|saturday|holiday)-(?:morning|day|evening|night)&n=/,
    );
  });

  test("결과 화면: 고른 기준·펼친 후보·스크롤 위치가 남는다", async ({ page }) => {
    await open(page, screen("result"));
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page).toHaveURL(/m=q/);
    // 새 기준의 결과가 다 들어온 뒤에 후보를 펼친다(이전 결과를 잠시 보여 주는 동안 누르면 줄이 바뀐다).
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
    const others = page.getByRole("region", { name: "다른 후보" });
    // 후보 줄만 고른다(줄 안의 막차 칸도 접는 칸이다).
    const second = others.locator(":scope > details").first();
    await second.locator(":scope > summary").click();
    await expect(second).toHaveAttribute("open", "");
    await others.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    for (const size of [UNFOLDED, FOLDED]) {
      await page.setViewportSize(size);
      await expect(page.getByRole("tab", { name: "빨리 만나기" })).toHaveAttribute("aria-selected", "true");
      await expect(second).toHaveAttribute("open", "");
      expect(await horizontalOverflow(page)).toEqual([]);
      // 화면을 맨 위로 되돌리지 않는다(다시 그리기·새로 고침이 아니다). 보고 있던 후보 목록이 화면 안에 남는다(스크롤 고정).
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(others).toBeInViewport();
    }
    await expect(page).toHaveURL(/m=q/);
  });

  test("방 참여 폼: 넣던 이름·출발역·숨기기가 남는다", async ({ page }) => {
    await open(page, screen("room-friend-join"));
    const form = page.getByRole("form", { name: "나도 출발역 넣기" });
    await form.getByRole("textbox", { name: "내 이름 (선택)" }).fill("서연");
    await pickStation(page, form.getByRole("combobox", { name: "내 출발역" }), "신촌", /^신촌\s?2호선/);
    await form.getByRole("checkbox", { name: /출발역 이름 숨기기/ }).check();

    for (const size of [UNFOLDED, FOLDED]) {
      await page.setViewportSize(size);
      await expect(form.getByRole("textbox", { name: "내 이름 (선택)" })).toHaveValue("서연");
      await expect(form.getByRole("combobox", { name: "내 출발역" })).toHaveValue("신촌");
      await expect(form.getByRole("checkbox", { name: /출발역 이름 숨기기/ })).toBeChecked();
      expect(await horizontalOverflow(page)).toEqual([]);
      await expectColumns(page, form, page.getByRole("article").first());
    }
  });
});

test.describe("데스크톱 키보드", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test("Tab으로 차례대로 이동하며 포커스가 보이고, 키보드만으로 입력·제출한다", async ({ page }) => {
    await open(page, screen("home"));
    // Tab 순서: 워드마크 → 1번째 이름 → 1번째 역 → 2번째 이름 → 2번째 역 → 한 명 더 → 언제(요일) → 언제(시간대)
    // → (만날 역 찾기는 비활성) → 방 만들기 링크. 라디오 묶음은 묶음마다 한 번 멈추고 방향키로 고른다.
    const order = ["A", "INPUT", "INPUT", "INPUT", "INPUT", "BUTTON", "INPUT", "INPUT", "A"];
    // 처리방침 변경 공지 기간(공지 시작일 ≤ 오늘 < 시행일, 브라우저 날짜로 판단)에는 맨 위 한 줄 공지의 "자세히" 링크가 먼저 온다.
    // 공지는 하이드레이션 뒤에 그려지므로 입력 칸이 준비된 뒤에 센다.
    await expect(page.getByRole("textbox", { name: "1번째 사람 이름(선택)" })).toBeVisible();
    const notice = await page.getByRole("link", { name: "자세히" }).count();
    const expected = notice > 0 ? ["A", ...order] : order;
    const visited: string[] = [];
    for (let i = 0; i < expected.length; i += 1) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        const ring = cs.boxShadow !== "none";
        const outline = cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2;
        return {
          name: el.getAttribute("aria-label") ?? el.id ?? el.textContent,
          visible: ring || outline,
          tag: el.tagName,
        };
      });
      visited.push(focus.tag);
      expect.soft(focus.visible, `포커스 표시: ${focus.tag} ${focus.name}`).toBe(true);
    }
    expect(visited).toEqual(expected);

    // 키보드만으로: 이름 → Tab → 역(입력 후 Enter로 고름) → Tab … → Enter로 제출
    await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).focus();
    await page.keyboard.type("민수");
    await page.keyboard.press("Tab");
    await page.keyboard.type("강남");
    await expect(page.getByRole("option", { name: /^강남\s?2호선/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("강남");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("홍대입구");
    await expect(page.getByRole("option", { name: /^홍대입구\s?2호선/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("홍대입구");
    // 목록이 닫힌 역 칸에서 한 번 더 Enter를 누르면 폼이 제출된다.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=(?:weekday|saturday|holiday)-(?:morning|day|evening|night)&n=/,
    );

    // 결과: 기준 탭은 화살표 키로 옮긴다.
    await page.getByRole("tab", { name: "공평하게" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "빨리 만나기" })).toBeFocused();
  });
});

test.describe("큰 기본 글자(브라우저 글꼴 크기 24px = 150%)", () => {
  for (const vp of VIEWPORTS.filter((v) =>
    ["phone-320", "phone-390", "fold-open-690", "desktop-1280"].includes(v.id),
  )) {
    test.describe(vp.id, () => {
      useViewport(vp);
      for (const s of SCREENS) {
        test(s.id, async ({ page }) => {
          // 크롬 설정의 "글꼴 크기"와 같은 값(기본 16px). rem으로 잡은 크기·간격·브레이크포인트가 함께 커진다.
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 20 } });
          await open(page, s);
          expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("24px");
          await checkLayout(page, s.actions(page), vp.touch);
          if (s.columns) await expectColumns(page, ...s.columns(page));
        });
      }
    });
  }
});

/**
 * 경첩(Viewport Segments API): 크로미움 개발자 도구 프로토콜로 세로 경첩(왼쪽·오른쪽 두 조각)을 흉내 낸다.
 * 두 칸 화면의 모든 칸은 경첩을 피해 한 조각 안에만 있어야 한다. 경첩 위치는 펼친 Z Fold6 크기의 가운데.
 */
test.describe("경첩으로 나뉜 화면(Viewport Segments)", () => {
  const width = 928;
  const height = 1004;
  const hinge = { offset: 454, mask: 20 };
  test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  for (const id of ["home", "result", "room-new", "room-friend-join", "room-host-full"]) {
    test(id, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      // 탐색 전에 걸어야 문서의 미디어 쿼리·env()가 조각을 본다.
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: true,
        displayFeature: { orientation: "vertical", offset: hinge.offset, maskLength: hinge.mask },
      });
      await open(page, screen(id));
      expect(await page.evaluate(() => matchMedia("(horizontal-viewport-segments: 2)").matches)).toBe(true);
      const crossing = await page.evaluate(
        ({ start, end }) =>
          [...document.querySelectorAll("main > *")]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 1 && r.height > 1 && r.left < end && r.right > start)
            .map(({ el, r }) => `${el.tagName.toLowerCase()} ${Math.round(r.left)}–${Math.round(r.right)}`),
        { start: hinge.offset, end: hinge.offset + hinge.mask },
      );
      expect(crossing, "경첩에 걸친 칸").toEqual([]);
      expect(await horizontalOverflow(page)).toEqual([]);
      await shot(page, { id: "fold-split-928", label: "", width, height, touch: true, kind: "fold-open" }, id);
    });
  }
});

test("hover 효과는 마우스처럼 올려 둘 수 있는 기기에서만 켜진다((hover: hover) 안에만 있다)", async ({ page }) => {
  await page.goto("/");
  const { ungated, gated } = await page.evaluate(() => {
    const found: string[] = [];
    let ok = 0;
    const walk = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) walk(rule.cssRules, gated || /hover:\s*hover/.test(rule.conditionText));
        else if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes(":hover")) {
            if (gated) ok += 1;
            else found.push(rule.selectorText);
          }
          walk(rule.cssRules, gated); // 중첩 규칙(@media가 선택자 안에 있는 경우)
        } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules, gated);
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules, false);
    return { ungated: found, gated: ok };
  });
  expect(gated).toBeGreaterThan(10); // 검사가 실제로 hover 규칙을 찾았다
  expect(ungated).toEqual([]);
});
