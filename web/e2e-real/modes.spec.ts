import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * B1: 결과 화면에서 모드 탭(공평하게 / 빨리 만나기 / 누구 쪽으로)을 바꾸면 결과가 나와야 한다. 실제 서버·산출물에 붙어
 * 세 모드 × (2명·3명·4명·한 사람의 출발역이 1위인 경우)를 확인한다.
 *
 * 왜 가짜 서버 e2e가 놓쳤나: 첫 결과는 서버 컴포넌트가 서버를 직접 불러 받고(브라우저 Origin 없음), 탭을 바꿀 때만 브라우저가
 * `/api/v1/recommend`를 POST한다(Origin 있음). 운영의 서버 CORS 허용 목록은 비어 있어 Origin이 붙은 호출은 403이었는데, 가짜 서버는
 * CORS를 흉내 내지 않고, 로컬·CI의 실제 서버는 허용 목록에 웹 주소가 들어 있어 통과했다. 이 차이는 프록시 단위 테스트
 * (src/lib/proxy: Origin을 서버로 넘기지 않는다)가 지킨다. 이 파일은 그 뒤의 화면 쪽(요청 모양·응답 처리·URL 상태)을 지킨다.
 *
 * 역 코드는 dev 산출물 기준이다: k3a 강남, ryf 홍대입구, 1qs 신촌, 2je 혜화, 03j 광화문, 0js 마포.
 * UPDATE_SCREENSHOTS=1 이면 docs/setup/b1-screens/에 저장한다(PR·노트용).
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/b1-screens");
async function shot(page: Page, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage: true });
}

/**
 * 눌러서 서버를 다시 부르게 하고 응답이 올 때까지 기다린다. 응답 전에는 이전 결과가 자리표시로 남아 있어서, 기다리지 않으면
 * 실패한 호출도 "결과가 보인다"로 통과한다.
 */
async function switchAndSettle(page: Page, action: () => Promise<void>) {
  const settled = page.waitForResponse((r) => r.url().endsWith("/api/v1/recommend") && r.request().method() === "POST");
  await action();
  expect((await settled).status()).toBe(200);
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("tabpanel").getByRole("alert")).toHaveCount(0);
}

const SCENARIOS = [
  { name: "2명", origins: ["k3a", "ryf"] },
  { name: "3명", origins: ["k3a", "ryf", "1qs"] },
  { name: "4명", origins: ["k3a", "ryf", "1qs", "2je"] },
  // 빨리 만나기 1위가 광화문·마포 중 한 사람의 출발역이다(그 사람의 시간은 0분).
  { name: "한 사람의 출발역이 1위", origins: ["03j", "0js"], topIsOrigin: true },
] as const;

for (const scenario of SCENARIOS) {
  test(`${scenario.name}: 결과 화면에서 세 모드를 오가도 결과가 나온다`, async ({ page }) => {
    const requests: { status: number; body: string }[] = [];
    page.on("response", async (response) => {
      if (response.url().endsWith("/api/v1/recommend") && response.request().method() === "POST") {
        requests.push({ status: response.status(), body: response.request().postData() ?? "" });
      }
    });
    const origins = scenario.origins.join(".");
    await page.goto(`/result?v=1&o=${origins}&m=f`);
    const top = page.getByRole("article").first();
    await expect(top.getByText("1위")).toBeVisible();
    if (scenario.name === "2명") await shot(page, "after-1-fair");

    // 빨리 만나기: 브라우저가 서버를 다시 부른다.
    await switchAndSettle(page, () => page.getByRole("tab", { name: "빨리 만나기" }).click());
    await expect(page).toHaveURL(/m=q$/);
    await expect(page.getByRole("tab", { name: "빨리 만나기" })).toHaveAttribute("aria-selected", "true");
    await expect(top.getByText("1위")).toBeVisible();
    await expect(page.getByRole("tabpanel").getByRole("alert")).toHaveCount(0);
    if (scenario.name === "2명") await shot(page, "after-2-fast");
    if ("topIsOrigin" in scenario) {
      // 한 사람의 출발역이 만날 역이다: 그 사람의 시간(0분)도 화면에 있어야 한다.
      await expect(top.getByRole("listitem").getByText(/^(광화문|마포)$/)).toHaveCount(2);
    }

    // 누구 쪽으로: 대상을 고르는 줄이 나오고, 요청에 대상(favorIndex)이 실린다.
    await switchAndSettle(page, () => page.getByRole("tab", { name: "누구 쪽으로" }).click());
    await expect(page).toHaveURL(/m=p[0-3]$/);
    const picker = page.getByRole("group", { name: "누구 쪽으로 기울일까요?" });
    await expect(picker.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(top.getByText("1위")).toBeVisible();
    await expect(page.getByRole("tabpanel").getByRole("alert")).toHaveCount(0);
    if (scenario.name === "2명") await shot(page, "after-3-favor");

    // 다른 사람 쪽으로 바꾼다.
    const others = picker.getByRole("button", { pressed: false });
    await switchAndSettle(page, () => others.first().click());
    await expect(page).toHaveURL(/m=p[0-3]$/);
    await expect(top.getByText("1위")).toBeVisible();
    await expect(page.getByRole("tabpanel").getByRole("alert")).toHaveCount(0);

    // 모든 POST가 성공했고, favor 요청에는 favorIndex가 있다.
    expect(requests.filter((r) => r.status !== 200)).toEqual([]);
    const favor = requests.filter((r) => r.body.includes('"mode":"favor"'));
    expect(favor.length).toBeGreaterThan(0);
    for (const r of favor) expect(r.body).toMatch(/"favorIndex":[0-3]/);
    expect(requests.some((r) => r.body.includes('"mode":"fast"'))).toBe(true);
  });
}

test("받은 링크(/s)에서도 기준을 바꾸면 결과가 나온다", async ({ page }) => {
  await page.goto("/s?v=1&o=k3a.ryf&m=f");
  const top = page.getByRole("article").first();
  await expect(top.getByText("1위")).toBeVisible();
  await switchAndSettle(page, () => page.getByRole("tab", { name: "빨리 만나기" }).click());
  await expect(top.getByText("1위")).toBeVisible();
  await switchAndSettle(page, () => page.getByRole("tab", { name: "누구 쪽으로" }).click());
  await expect(top.getByText("1위")).toBeVisible();
});

test("링크가 처음부터 빨리 만나기·누구 쪽으로여도 열린다", async ({ page }) => {
  await page.goto("/result?v=1&o=k3a.ryf&m=q");
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await page.goto("/result?v=1&o=k3a.ryf&m=p1");
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
});
