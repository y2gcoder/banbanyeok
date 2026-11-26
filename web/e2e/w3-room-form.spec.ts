import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";

/**
 * W3 방 만들기 폼: ① 이름 칸이 보이는 라벨·입력칸 모양을 갖는다 ② "언제 만나요?"가 날짜 칩 · 시간대 칩 · 접힌 정확한 시각으로 바뀌었다.
 * 폰(320·390)은 위아래로 쌓고 가로 넘침이 없으며, 칩은 44px 이상이다. 시간대만 고르면 요청에 meetingBand만 실리고 meetingTime은 없다.
 * W3_SCREENSHOTS=<폴더>이면 그 폴더에 390×844·320×568·768×1024 캡처를 남긴다(저장소에는 넣지 않는다).
 */
const SIZES = [
  { id: "390x844", width: 390, height: 844, touch: true },
  { id: "320x568", width: 320, height: 568, touch: true },
  { id: "768x1024", width: 768, height: 1024, touch: true },
  { id: "1280x800", width: 1280, height: 800, touch: false },
] as const;

async function shot(page: Page, size: string, name: string) {
  const dir = process.env.W3_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(resolve(dir, size), { recursive: true });
  await page.screenshot({ path: resolve(dir, size, `${name}.png`), fullPage: true, scale: "css" });
}

async function openForm(page: Page) {
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp; // 수화가 끝나야 칩이 움직인다.
  await expect(page.getByRole("radio", { name: /이번 토요일\s*\d+월 \d+일 \(토\)/ })).toBeVisible();
}

const whenGroup = (page: Page) => page.getByRole("group", { name: "언제 만나요? (선택)" });

for (const size of SIZES) {
  test.describe(`방 만들기 ${size.id}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch });

    test("이름 칸 라벨, 칩 크기, 넘침 없음, 좁으면 위아래·넓으면 좌우", async ({ page }) => {
      await openForm(page);
      await expect(page.locator("main > form")).toHaveCSS("grid-column-start", size.width >= 640 ? "2" : "auto");
      // 보이는 라벨(화면 낭독기는 앞에 "내"를 더 읽는다).
      await expect(page.locator("label", { hasText: /^내 이름 \(선택\)$/ })).toBeVisible();
      await expect(page.locator("label", { hasText: /^내 출발역$/ })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "내 이름 (선택)" })).toHaveAttribute("placeholder", "예: 민수");
      expect(await horizontalOverflow(page)).toEqual([]);

      const when = whenGroup(page);
      const chips = [
        ...(await when.getByRole("radio").all()),
        when.getByLabel("날짜 선택"),
        when.getByRole("button", { name: "+ 정확한 시각 넣기" }),
      ];
      for (const chip of chips) {
        const box = await chip.boundingBox();
        expect(box?.height ?? 0, await chip.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
      }
      // 날짜 칩 묶음과 시간대 칩 묶음: 칸이 24rem 이상이면 좌우, 아니면 위아래.
      const dayBox = await when.getByRole("group", { name: "날짜" }).boundingBox();
      const bandBox = await when.getByRole("radiogroup", { name: "시간대" }).boundingBox();
      const fieldWidth = (await when.boundingBox())?.width ?? 0;
      if (!dayBox || !bandBox) throw new Error("칩 묶음이 없다");
      if (fieldWidth >= 384) expect(bandBox.x).toBeGreaterThan(dayBox.x + dayBox.width - 1);
      else expect(bandBox.y).toBeGreaterThan(dayBox.y + dayBox.height - 1);
      for (const radio of await when.getByRole("radio").all()) {
        const box = await radio.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width);
      }
      await when.scrollIntoViewIfNeeded();
      await shot(page, size.id, "1-empty");

      await when.getByRole("radio", { name: /이번 토요일/ }).check();
      await when.getByRole("radio", { name: /저녁/ }).check();
      await when.getByRole("button", { name: "+ 정확한 시각 넣기" }).click();
      await expect(when.getByLabel("시각", { exact: true })).toBeFocused();
      await expect(page.getByText("토요일 저녁 기준으로 계산해요")).toBeVisible();
      expect(await horizontalOverflow(page)).toEqual([]);
      await shot(page, size.id, "2-saturday-evening");
    });
  });
}

test("키보드: 화살표로 칩을 옮기고 Space로 지운다", async ({ page }) => {
  await openForm(page);
  const when = whenGroup(page);
  const morning = when.getByRole("radio", { name: /아침/ });
  await morning.focus();
  await page.keyboard.press("Space");
  await expect(morning).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(when.getByRole("radio", { name: /낮/ })).toBeChecked();
  await expect(page.getByText("평일 낮 기준으로 계산해요")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("평일 저녁 기준으로 계산해요")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(when.getByRole("radio", { name: /저녁/ })).not.toBeChecked();
  await expect(page.getByText("평일 낮 기준으로 계산해요")).toBeVisible();
});

test("시간대만 고르면 meetingBand만 보내고, 정확한 시각을 넣으면 meetingTime만 보낸다", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/rooms", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { code: "INVALID_REQUEST", message: "테스트" } });
  });
  await openForm(page);
  await page.getByRole("combobox", { name: "내 출발역" }).fill("혜화");
  await page.getByRole("option", { name: /^혜화\s?4호선/ }).click();
  const when = whenGroup(page);
  await when.getByRole("radio", { name: /내일/ }).check();
  await when.getByRole("radio", { name: /밤/ }).check();
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ meetingBand: "night" });
  expect(bodies[0]).toHaveProperty("meetingDate");
  expect(bodies[0]).not.toHaveProperty("meetingTime");

  await when.getByRole("button", { name: "+ 정확한 시각 넣기" }).click();
  await when.getByLabel("시각", { exact: true }).fill("08:30");
  await expect(when.getByRole("radio", { name: /아침/ })).toBeChecked();
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ meetingTime: "08:30" });
  expect(bodies[1]).not.toHaveProperty("meetingBand");
});
