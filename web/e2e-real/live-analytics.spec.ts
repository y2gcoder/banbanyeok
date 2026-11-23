import { gunzipSync } from "node:zlib";
import { expect, type Request, test } from "@playwright/test";

// 실제 배포 주소에서의 통계 확인(REAL_WEB_URL + LIVE_POSTHOG=1일 때만 돈다. 로컬·CI의 e2e:real에서는 건너뛴다).
// 동의 전에는 PostHog로 가는 요청이 0건이고, 동의 뒤에는 수집 주소로 이벤트가 나가 200을 받는지 본다. 이벤트 이름만 확인하고
// 속성은 읽거나 출력하지 않는다. PostHog는 자동화 브라우저를 봇으로 보고 이벤트를 버리므로 봇 신호만 이 테스트 안에서 끈다.
test.skip(!process.env.LIVE_POSTHOG, "LIVE_POSTHOG=1 일 때만 실제 PostHog로 한 건을 보낸다");

const POSTHOG = /^https:\/\/[a-z]+\.i\.posthog\.com\//;

function eventNames(request: Request): string[] {
  const body = request.postDataBuffer();
  if (!body) return [];
  let text: string;
  try {
    text = gunzipSync(body).toString("utf8");
  } catch {
    text = body.toString("utf8");
  }
  const parsed = JSON.parse(text) as { event?: string } | { event?: string }[] | { batch?: { event?: string }[] };
  const list = Array.isArray(parsed)
    ? parsed
    : "batch" in parsed && parsed.batch
      ? parsed.batch
      : [parsed as { event?: string }];
  return list.map((item) => item.event ?? "?");
}

test("동의 전 PostHog 요청 0건, 동의 뒤 이벤트가 PostHog US로 나간다", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
  const toPostHog: Request[] = [];
  page.on("request", (request) => {
    if (POSTHOG.test(request.url())) toPostHog.push(request);
  });
  const responses: number[] = [];
  page.on("response", (response) => {
    if (POSTHOG.test(response.url())) responses.push(response.status());
  });

  await page.goto("/");
  const banner = page.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
  await expect(banner).toBeVisible();
  await page.getByRole("link", { name: "개인정보 처리방침" }).first().waitFor({ state: "attached" });
  await page.waitForTimeout(5000);
  expect(toPostHog.map((request) => request.url())).toEqual([]);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => /^ph_|^__ph_|bby\.analytics\.seen/.test(key))),
  ).toEqual([]);

  await banner.getByRole("checkbox", { name: /이용 통계 수집·이용에 동의/ }).check();
  await banner.getByRole("checkbox", { name: /통계의 국외 이전에 동의/ }).check();
  await banner.getByRole("button", { name: "동의하고 닫기" }).click();

  await expect.poll(() => toPostHog.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => responses.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const urls = [...new Set(toPostHog.map((request) => `${request.method()} ${request.url().split("?")[0]}`))];
  const names = toPostHog.flatMap(eventNames);
  test.info().annotations.push({ type: "posthog-requests", description: urls.join(", ") });
  test.info().annotations.push({ type: "posthog-events", description: names.join(", ") });
  expect(urls).toEqual(["POST https://us.i.posthog.com/e/"]);
  expect(names).toContain("analytics_consent_changed");
  expect(responses.every((status) => status === 200)).toBe(true);
});
