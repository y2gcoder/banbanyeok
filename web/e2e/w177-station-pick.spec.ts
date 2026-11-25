import { expect, type Locator, type Page, test } from "@playwright/test";
import { prepareRoom } from "./support/room-fixture";

/**
 * #177 출발역 목록에서 역을 고르면 그 역만 들어가고 다른 칸은 그대로다.
 *
 * ① 클릭 관통: 항목을 누르면 목록이 바로 닫힘 상태가 되어(닫히는 동안은 포인터를 받지 않는다) 그 아래가 드러난다. 더블클릭·두 번 탭의
 *    두 번째 누름이 바로 아래 '출발역 이름 숨기기'(첫 화면은 '한 명 더')를 누르면 안 된다.
 * ② 한 틱에 여러 변경: 역 선택과 숨기기 변경이 다시 그리기 전에 함께 와도 서로 덮지 않는다(옛 값을 펼쳐 쓰면 뒤의 것이 역을 지운다).
 */
const SIZES = [
  { id: "1366x1024", width: 1366, height: 1024, touch: false },
  { id: "1280x800", width: 1280, height: 800, touch: false },
  { id: "390x844", width: 390, height: 844, touch: true },
] as const;

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
  return fieldsIn(page.locator("form").filter({ has: page.locator('input[type="checkbox"][id$="-hidden"]') }));
}

const FORMS = [
  { id: "방 만들기", open: openCreate },
  { id: "방 참여", open: openJoin },
] as const;

/** 검색어를 치고 목록의 그 역 항목을 돌려준다. */
async function search(page: Page, station: Locator, query: string, pick: RegExp): Promise<Locator> {
  await station.click();
  await station.pressSequentially(query);
  const option = page.getByRole("option", { name: pick }).first();
  await expect(option).toBeVisible();
  return option;
}

type Point = { x: number; y: number };

/** 목록 항목과 그 아래 요소가 겹치는 영역의 가운데. 겹치지 않으면 null. */
async function overlapCenter(option: Locator, under: Locator): Promise<Point | null> {
  const [a, b] = await Promise.all([option.boundingBox(), under.boundingBox()]);
  if (!a || !b) throw new Error("상자가 없다");
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return left < right && top < bottom ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
}

async function centerOf(target: Locator): Promise<Point> {
  const box = await target.boundingBox();
  if (!box) throw new Error("누를 항목이 없다");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 같은 자리를 두 번 누른다: 마우스는 더블클릭, 터치는 두 번 탭. */
async function pressTwice(page: Page, { x, y }: Point, touch: boolean) {
  if (touch) {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.move(x, y);
    await page.mouse.dblclick(x, y, { delay: 40 });
  }
}

for (const size of SIZES) {
  test.describe(`#177 ${size.id}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch });

    for (const { id, open } of FORMS) {
      test(`${id}: 목록의 역을 두 번 눌러도 그 역만 들어가고 숨기기·이름은 그대로`, async ({ page }) => {
        const f = await open(page);
        await f.name.fill("서연");
        const option = await search(page, f.station, "서울대입구", /^서울대입구/);
        // 방 만들기는 모든 크기에서 목록 항목이 바로 아래 숨기기 칸 위에 뜬다. 그 겹친 곳을 누른다. 방 참여는 폼이 화면 아래쪽이면
        // 목록이 위로 열려 겹치지 않으므로 항목 가운데를 누르고, 다른 칸이 바뀌지 않는지만 본다.
        const under = await overlapCenter(option, f.hiddenLabel);
        if (id === "방 만들기") expect(under, "목록 항목이 숨기기 칸 위에 떠야 한다").not.toBeNull();
        await pressTwice(page, under ?? (await centerOf(option)), size.touch);
        await expect(page.getByRole("option")).toHaveCount(0);
        await page.waitForTimeout(300); // 닫힘 애니메이션·뒤늦은 클릭이 지나간 뒤에도 그대로인지 본다.
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.hidden).not.toBeChecked();
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
        await expect(page.getByRole("option")).toHaveCount(0);
        await page.waitForTimeout(300);
        await expect(f.station).toHaveValue("서울대입구");
        await expect(f.hidden).toBeChecked();
        await expect(f.name).toHaveValue("서연");
      });
    }

    test("첫 화면: 마지막 사람 칸에서 역을 두 번 눌러도 그 역만 들어가고 줄은 늘지 않는다", async ({ page }) => {
      const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
      await page.goto("/");
      await warmUp;
      const form = page.locator("form").filter({ has: page.locator('input[id*="-station-"]') });
      const rows = form.locator("ol > li");
      await expect(rows).toHaveCount(2);
      const first = rows.nth(0).locator('input[id*="-station-"]');
      const last = rows.nth(1).locator('input[id*="-station-"]');
      const firstName = rows.nth(0).locator('input[id*="-name-"]');
      await firstName.fill("민수");
      const option = await search(page, last, "서울대입구", /^서울대입구/);
      // 넓은 화면에서는 마지막 줄의 목록 항목이 바로 아래 '한 명 더' 버튼 위에 뜬다. 그 겹친 곳을 누른다. 폰에서는 겹치지 않으므로
      // 항목 가운데를 누르고, 다른 칸이 바뀌지 않는지만 본다.
      const under = await overlapCenter(option, form.locator("button", { hasText: "한 명 더" }));
      if (!size.touch) expect(under, "목록 항목이 '한 명 더' 위에 떠야 한다").not.toBeNull();
      await pressTwice(page, under ?? (await centerOf(option)), size.touch);
      await expect(page.getByRole("option")).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(last).toHaveValue("서울대입구");
      await expect(rows).toHaveCount(2);
      await expect(first).toHaveValue("");
      await expect(firstName).toHaveValue("민수");
    });
  });
}
