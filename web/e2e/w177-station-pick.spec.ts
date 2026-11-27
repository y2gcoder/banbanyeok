import { expect, type Locator, type Page, test } from "@playwright/test";
import { prepareRoom } from "./support/room-fixture";

/**
 * #177 출발역 목록에서 역을 고르면 그 역만 들어가고 다른 칸은 그대로다.
 *
 * 출발역 숨기기는 새로 켤 수 없어서(ADR-0007) 숨기기 칸은 이미 숨긴 본인의 '내 출발역 고치기'에만 있다. 숨기기 칸을 쓰는 경우는 그
 * 폼에서 보고(처음에 켜져 있다), 방 만들기·참여에서는 두 번째 누름이 아래 칸 어디에도 닿지 않는지를 본다.
 *
 * ① 클릭 관통: 항목을 누르면 목록이 바로 닫힘 상태가 되어(닫히는 동안은 포인터를 받지 않는다) 그 아래가 드러난다. 더블클릭·두 번 탭의
 *    두 번째 누름이 바로 아래 칸('출발역 이름 계속 숨기기', 추천 기준, '참여하기', 첫 화면은 '한 명 더')을 누르면 안 된다. 마우스(데스크톱
 *    Chromium), 안드로이드 터치(Chromium), iOS 터치(WebKit, 두 번째 탭도 click detail이 1이다)에서 본다(playwright.config.ts의 프로젝트).
 *    두 번째 누름은 목록이 닫힘 상태가 된 뒤, 그 자리의 히트 테스트가 아래 칸을 가리키는 것을 확인하고 누른다(겹치지 않으면 실패).
 * ② 한 틱에 여러 변경: 역 선택과 숨기기 변경이 다시 그리기 전에 함께 와도 서로 덮지 않는다(옛 값을 펼쳐 쓰면 뒤의 것이 역을 지운다).
 * ③ 한글 조합 중 한 번 누름(운영자 제보: 맥에서 마우스로 한 번 눌렀는데 역은 안 들어가고 숨기기가 켜짐): "서울" 뒤에 "대"를 조합하는
 *    중이면 목록이 입력 칸보다 한 글자 늦었다("서울" 목록, 서울대입구가 셋째). macOS는 누르는 순간 조합을 먼저 확정하므로 목록이
 *    "서울대" 목록으로 바뀌어 누른 자리에 항목이 없고 누름이 아래 라벨에 떨어졌다. 누르기 전과 확정한 뒤 모두 그 자리의 히트 테스트가
 *    항목이어야 한다(Chromium은 CDP의 trusted 조합, WebKit은 페이지에서 보낸 조합 이벤트). 확정이 누름보다 늦는 경우(고른 뒤 확정)에도
 *    입력 칸은 고른 역 이름이어야 한다.
 * ④ 그대로여야 하는 것: 한 번 눌러 고른 뒤 목록 밖을 바로 누르는 것, Enter로 고른 뒤 바로 숨기기 칸을 누르는 것, 마우스로 따로 누른
 *    클릭(detail 1), 두 번째 누름 도중 키보드 Space(detail 0 click).
 */
const SIZES = [
  { project: "desktop-chrome", width: 1366, height: 1290 }, // 제보 화면(2732×2578 @2x)
  { project: "desktop-webkit", width: 1366, height: 1290 },
  { project: "desktop-chrome", width: 1366, height: 1024 },
  { project: "desktop-chrome", width: 1280, height: 800 },
  { project: "mobile-chrome", width: 390, height: 844 },
  { project: "iphone-webkit", width: 390, height: 844 },
] as const;

type Point = { x: number; y: number };

const listClosed = (page: Page) =>
  page.waitForFunction(() => !document.querySelector('[data-slot="combobox-content"][data-open]'));
type Fields = { name: Locator; station: Locator; hidden: Locator; hiddenLabel: Locator };

// 역 목록이 열리면 나머지 화면은 접근성 트리에서 가려지므로 칸은 CSS로 찾는다.
function fieldsIn(form: Locator): Fields {
  return {
    name: form.locator('input[id$="-name"]'),
    station: form.locator('input[id$="-station"]'),
    hidden: form.locator('input[type="checkbox"][id$="-hidden"]'),
    hiddenLabel: form.locator('label[for$="-hidden"]'),
  };
}

async function openCreate(page: Page): Promise<Fields> {
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp; // 수화가 끝나야 입력이 움직인다.
  return fieldsIn(page.locator("form").filter({ has: page.locator('input[id$="-host-station"]') }));
}

async function openJoin(page: Page): Promise<Fields> {
  await page.goto(await prepareRoom(page, "friend-alone"));
  const form = page.getByRole("form", { name: "나도 출발역 넣기" });
  await expect(form).toBeVisible();
  return fieldsIn(form);
}

/** 출발역을 이미 숨긴 본인의 '내 출발역 고치기'. 숨기기 칸이 켜진 채로 있고, 출발역 칸은 비워 둔다(검색어만 들어가게). */
async function openEditHidden(page: Page): Promise<Fields> {
  await page.goto(await prepareRoom(page, "hidden-self"));
  await page.getByRole("button", { name: "수정 내 항목" }).click();
  const form = page.getByRole("form", { name: "내 출발역 고치기" });
  await expect(form).toBeVisible();
  const f = fieldsIn(form);
  await expect(f.hidden).toBeChecked();
  await f.station.fill("");
  await page.keyboard.press("Escape");
  await listClosed(page);
  return f;
}

/** 숨기기 칸이 있는 폼(이미 숨긴 본인). */
const HIDE_FORMS = [{ id: "내 항목 고치기(이미 숨긴 본인)", open: openEditHidden }] as const;

/** 숨기기 칸이 없는 폼. 두 번째 누름은 아래의 무엇에도 닿지 않아야 한다. */
const NO_HIDE_FORMS = [
  { id: "방 만들기", open: openCreate },
  { id: "방 참여", open: openJoin },
] as const;

/**
 * 페이지의 진짜(isTrusted) click 수를 센다. 다른 리스너보다 먼저 등록되어 삼켜진 click도 센다(`__trustedClicks`). 문서까지 닿은
 * click은 따로 센다(`__documentClicks`: 삼킨 click은 window 캡처에서 멈춰 여기 오지 않는다).
 */
async function countClicks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __trustedClicks: number; __documentClicks: number };
    w.__trustedClicks = 0;
    w.__documentClicks = 0;
    window.addEventListener(
      "click",
      (e) => {
        if (e.isTrusted) w.__trustedClicks++;
      },
      true,
    );
    document.addEventListener(
      "click",
      (e) => {
        if (e.isTrusted) w.__documentClicks++;
      },
      true,
    );
  });
}
const clicksSoFar = (page: Page) =>
  page.evaluate(() => (window as unknown as { __trustedClicks: number }).__trustedClicks);
const documentClicksSoFar = (page: Page) =>
  page.evaluate(() => (window as unknown as { __documentClicks: number }).__documentClicks);

/** 칸을 화면 맨 위로 올리고(목록이 아래로 열리게) 검색어를 친 뒤 그 역 항목을 돌려준다. */
async function search(page: Page, station: Locator, query: string, pick: RegExp): Promise<Locator> {
  await station.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await station.click();
  await station.pressSequentially(query);
  const option = page.getByRole("option", { name: pick }).first();
  await expect(option).toBeVisible();
  return option;
}

type Ime = { start: (syllable: string) => Promise<void>; commit: (syllable: string) => Promise<void> };

/**
 * 한글 조합을 흉내 낸다. Chromium은 CDP로 브라우저가 직접 조합 이벤트를 낸다(Input.imeSetComposition → Input.insertText로 확정,
 * trusted). WebKit은 CDP가 없어 페이지에서 같은 순서의 이벤트를 보낸다. 확정 뒤에는 화면이 다시 그려진 뒤 돌아온다.
 */
async function imeFor(page: Page, station: Locator, browserName: string): Promise<Ime> {
  const painted = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    return {
      start: async (text) => {
        await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      },
      commit: async (text) => {
        await cdp.send("Input.insertText", { text });
        await painted();
      },
    };
  }
  return {
    start: (syllable) =>
      station.evaluate((el: HTMLInputElement, ch) => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
        setValue?.call(el, el.value + ch);
        el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: ch }));
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data: ch }),
        );
      }, syllable),
    commit: async (syllable) => {
      await station.evaluate((el, ch) => {
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: ch }));
      }, syllable);
      await painted();
    },
  };
}

const hits = (target: Locator, { x, y }: Point) =>
  target.evaluate(
    (el, p) => {
      const found = document.elementFromPoint(p.x, p.y);
      return found !== null && el.contains(found);
    },
    { x, y },
  );

/** 목록 항목과 그 아래 요소가 겹치는 영역의 가운데. 겹치지 않으면 실패한다. */
async function overlapCenter(option: Locator, under: Locator): Promise<Point> {
  const [a, b] = await Promise.all([option.boundingBox(), under.boundingBox()]);
  if (!a || !b) throw new Error("상자가 없다");
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  expect(left < right && top < bottom, "목록 항목이 아래 칸 위에 떠야 한다").toBe(true);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * 같은 자리를 두 번 누른다(마우스는 더블클릭, 터치는 두 번 탭). 두 번째 누름은 목록이 닫힘 상태가 되고 그 자리의 히트 테스트가
 * `under`를 가리킬 때 누르고, 그 누름의 click이 문서에 온 것까지 기다린다.
 */
async function pressTwice(page: Page, point: Point, under: Locator, touch: boolean) {
  const before = await clicksSoFar(page);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect.poll(() => clicksSoFar(page)).toBe(before + 1);
  await listClosed(page);
  expect(await hits(under, point), "두 번째 누름 자리에 아래 칸이 드러나야 한다").toBe(true);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else {
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
  }
  await expect.poll(() => clicksSoFar(page)).toBe(before + 2);
  await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
}

for (const size of SIZES) {
  test.describe(`#177 ${size.project} ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== size.project, "이 크기는 다른 프로젝트에서 본다");
      await countClicks(page);
    });
    const touch = !size.project.startsWith("desktop-");

    for (const { id, open } of NO_HIDE_FORMS) {
      test(`${id}: 숨기기 칸이 없고, 목록의 역을 두 번 눌러도 그 역만 들어가며 두 번째 누름은 아래에 닿지 않는다`, async ({
        page,
      }) => {
        const f = await open(page);
        await expect(f.hidden).toHaveCount(0);
        const posts: string[] = [];
        page.on("request", (req) => {
          if (req.method() === "POST") posts.push(req.url());
        });
        await f.name.fill("서연");
        const option = await search(page, f.station, "서울대입구", /^서울대입구/);
        const box = await option.boundingBox();
        if (!box) throw new Error("목록 항목이 없다");
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const before = await clicksSoFar(page);
        if (touch) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        await expect.poll(() => clicksSoFar(page)).toBe(before + 1);
        await listClosed(page);
        // 드러난 자리는 출발역 칸 아래의 무언가다(빈 자리가 아니다).
        const revealed = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest("form") !== null,
          point,
        );
        expect(revealed, "두 번째 누름 자리에 폼의 아래 칸이 드러나야 한다").toBe(true);
        const reached = await documentClicksSoFar(page);
        if (touch) await page.touchscreen.tap(point.x, point.y);
        else {
          await page.mouse.down({ clickCount: 2 });
          await page.mouse.up({ clickCount: 2 });
        }
        await expect.poll(() => clicksSoFar(page)).toBe(before + 2);
        expect(await documentClicksSoFar(page), "두 번째 누름은 문서에 닿지 않는다").toBe(reached);
        await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.name).toHaveValue("서연");
        expect(posts).toEqual([]);
      });
    }

    for (const { id, open } of HIDE_FORMS) {
      test(`${id}: 목록의 역을 두 번 눌러도 그 역만 들어가고 숨기기·이름은 그대로`, async ({ page }) => {
        const f = await open(page);
        await f.name.fill("서연");
        const option = await search(page, f.station, "서울대입구", /^서울대입구/);
        await pressTwice(page, await overlapCenter(option, f.hiddenLabel), f.hiddenLabel, touch);
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.hidden).toBeChecked();
        await expect(f.name).toHaveValue("서연");
      });

      test(`${id}: 한글 조합 중에 목록의 역을 한 번 누르면(누르는 순간 확정) 그 역이 들어가고 숨기기는 그대로`, async ({
        page,
        browserName,
      }) => {
        const f = await open(page);
        await f.name.fill("서연");
        await search(page, f.station, "서울", /^서울대입구/);
        const ime = await imeFor(page, f.station, browserName);
        await ime.start("대");
        await expect(f.station).toHaveValue("서울대");
        const option = page.getByRole("option", { name: /^서울대입구/ });
        // 항목이 숨기기 라벨 위에 뜨는 곳을 누른다. 누르기 전에도, 누르는 순간 조합이 확정된 뒤에도 그 자리는 항목이어야 한다.
        const point = await overlapCenter(option, f.hiddenLabel);
        expect(await hits(option, point), "누르기 전 그 자리는 항목이다").toBe(true);
        await ime.commit("대");
        expect(await hits(option, point), "조합이 확정된 뒤에도 그 자리는 항목이다").toBe(true);
        const before = await clicksSoFar(page);
        if (touch) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        await expect.poll(() => clicksSoFar(page)).toBe(before + 1);
        await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.hidden).toBeChecked();
        await expect(f.name).toHaveValue("서연");
      });

      test(`${id}: 역 선택과 숨기기가 한 틱에 와도 서로 덮지 않는다`, async ({ page }) => {
        const f = await open(page);
        await f.name.fill("서연");
        const option = await search(page, f.station, "서울대입구", /^서울대입구/);
        // 다시 그리기 전에 두 변경을 잇달아 보낸다(같은 작업 안의 두 클릭).
        const [optionNode, hiddenNode] = await Promise.all([option.elementHandle(), f.hidden.elementHandle()]);
        await page.evaluate(
          ([o, h]) => {
            (o as HTMLElement).click();
            (h as HTMLElement).click();
          },
          [optionNode, hiddenNode] as const,
        );
        await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.hidden).not.toBeChecked();
        await expect(f.name).toHaveValue("서연");
      });
    }

    test("방 만들기: 조합을 확정하기 전에 역을 고르고 나중에 확정해도 입력 칸은 고른 역 이름이다(trusted 조합)", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "trusted 조합(CDP)은 Chromium에만 있다");
      // 안드로이드 UA에서는 Base UI가 조합을 따로 다루지 않고, 헤드리스의 CDP 조합은 안드로이드 키보드의 동작과 다르다.
      test.skip(touch, "데스크톱 IME 경로");
      const f = await openCreate(page);
      await search(page, f.station, "서울", /^서울대입구/);
      const ime = await imeFor(page, f.station, browserName);
      await ime.start("대");
      await expect(page.getByRole("option")).toHaveCount(2); // "서울대" 목록
      const option = page.getByRole("option", { name: /^서울대입구/ });
      if (touch) await option.tap();
      else await option.click();
      // 목록이 다 닫힌 뒤에 확정한다(닫히는 중에 확정하면 Base UI의 닫힘 정리가 입력 칸을 고른 역 이름으로 되돌려 준다).
      await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
      await ime.commit("대");
      await expect(f.station).toHaveValue("서울대입구");
      await f.station.blur();
      await expect(f.station).toHaveValue("서울대입구");
      // 보정은 그 조합 한 번뿐이다: 전체를 골라 새로 '서울대'를 넣으면 그대로 '서울대'다(되돌리지 않는다).
      await f.station.click();
      await f.station.selectText();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.insertText", { text: "서울대" });
      await expect(f.station).toHaveValue("서울대");
      await expect(page.getByRole("option")).toHaveCount(2);
    });

    test("방 만들기: 고른 뒤 그 조합이 다른 글자로 늦게 확정돼도 입력 칸은 고른 역 이름이다(trusted 조합)", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium" || touch, "데스크톱 Chromium의 trusted 조합(CDP)");
      const f = await openCreate(page);
      await search(page, f.station, "서울", /^서울대입구/);
      const ime = await imeFor(page, f.station, browserName);
      await ime.start("대");
      const option = page.getByRole("option", { name: /^서울대입구/ });
      await option.click();
      await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0);
      await ime.start("데"); // 확정 전에 조합이 바뀐다
      await ime.commit("데");
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("방 만들기: 조합을 확정하는 Enter(keyCode 229)는 역을 고르지도 폼을 제출하지도 않는다(trusted 조합)", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium" || touch, "데스크톱 Chromium의 trusted 조합(CDP)");
      const f = await openCreate(page);
      await search(page, f.station, "서울", /^서울대입구/);
      const ime = await imeFor(page, f.station, browserName);
      await ime.start("대");
      await expect(page.getByRole("option").first()).toHaveAttribute("data-highlighted", "");
      const posts: string[] = [];
      page.on("request", (req) => {
        if (req.method() === "POST") posts.push(req.url());
      });
      // IME가 후보를 확정하는 Enter: key는 Enter, keyCode는 229(VK_PROCESSKEY).
      const cdp = await page.context().newCDPSession(page);
      const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...enter });
      await ime.commit("대");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });
      await expect(f.station).toHaveValue("서울대");
      await expect(page.getByRole("option", { name: /^서울대입구/ })).toBeVisible();
      await expect(page.getByText("출발역을 골라 주세요.")).toHaveCount(0);
      expect(posts).toEqual([]);
      // 확정한 뒤의 Enter는 강조된 항목을 고른다.
      await page.keyboard.press("Enter");
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("내 항목 고치기: 마우스로 고른 뒤 따로 누른 클릭(detail 1)은 고른 자리 바로 옆이어도 닿는다", async ({
      page,
    }) => {
      test.skip(touch, "마우스만");
      const f = await openEditHidden(page);
      const option = await search(page, f.station, "서울대입구", /^서울대입구/);
      const point = await overlapCenter(option, f.hiddenLabel);
      await page.mouse.click(point.x, point.y);
      await listClosed(page);
      const beside = { x: point.x + 18, y: point.y };
      expect(await hits(f.hiddenLabel, beside), "옆자리에 숨기기 라벨이 드러나야 한다").toBe(true);
      await page.mouse.click(beside.x, beside.y, { clickCount: 1 });
      await expect(f.hidden).not.toBeChecked();
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("내 항목 고치기: 더블클릭의 두 번째 누름 도중 키보드 Space는 그대로이고, 그 마우스 클릭만 막는다", async ({
      page,
    }) => {
      test.skip(touch, "마우스만");
      const f = await openEditHidden(page);
      const option = await search(page, f.station, "서울대입구", /^서울대입구/);
      const point = await overlapCenter(option, f.hiddenLabel);
      await page.mouse.click(point.x, point.y);
      await listClosed(page);
      expect(await hits(f.hiddenLabel, point), "두 번째 누름 자리에 숨기기 라벨이 드러나야 한다").toBe(true);
      await f.hidden.focus();
      await page.mouse.down({ clickCount: 2 });
      await page.keyboard.press("Space");
      await expect(f.hidden).not.toBeChecked();
      const before = await clicksSoFar(page);
      await page.mouse.up({ clickCount: 2 });
      await expect.poll(() => clicksSoFar(page)).toBe(before + 1);
      await expect(f.hidden).not.toBeChecked();
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("방 만들기: 한 번 눌러 고른 뒤 목록 밖(이름 칸)을 바로 누르면 그대로 움직인다", async ({ page }) => {
      const f = await openCreate(page);
      const option = await search(page, f.station, "서울대입구", /^서울대입구/);
      if (touch) await option.tap();
      else await option.click();
      await f.name.click();
      await expect(f.name).toBeFocused();
      await page.keyboard.type("민수");
      await expect(f.name).toHaveValue("민수");
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("내 항목 고치기: Enter로 고른 뒤 바로 숨기기 칸을 누르면 바뀐다", async ({ page }) => {
      const f = await openEditHidden(page);
      await search(page, f.station, "서울대입구", /^서울대입구/);
      await page.keyboard.press("Enter");
      await listClosed(page);
      const box = await f.hidden.boundingBox();
      if (!box) throw new Error("숨기기 칸이 없다");
      if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(f.hidden).not.toBeChecked();
      await expect(f.station).toHaveValue("서울대입구");
    });

    test("첫 화면: 마지막 사람 칸에서 역을 두 번 눌러도 그 역만 들어가고 줄은 늘지 않는다", async ({ page }) => {
      const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
      await page.goto("/");
      await warmUp;
      await page.getByRole("tab", { name: "방장이 입력" }).click();
      const form = page.locator("form").filter({ has: page.locator('input[id*="-station-"]') });
      const rows = form.locator("ol > li");
      await expect(rows).toHaveCount(2);
      const first = rows.nth(0).locator('input[id*="-station-"]');
      const last = rows.nth(1).locator('input[id*="-station-"]');
      const firstName = rows.nth(0).locator('input[id*="-name-"]');
      await firstName.fill("민수");
      const option = await search(page, last, "서울대입구", /^서울대입구/);
      // 마지막 줄의 목록 항목은 바로 아래 '한 명 더' 버튼 위에 뜬다. 그 겹친 곳을 두 번 누른다.
      const more = form.locator("button", { hasText: "한 명 더" });
      await pressTwice(page, await overlapCenter(option, more), more, touch);
      await expect(last).toHaveValue("서울대입구");
      await expect(rows).toHaveCount(2);
      await expect(first).toHaveValue("");
      await expect(firstName).toHaveValue("민수");
    });
  });
}
