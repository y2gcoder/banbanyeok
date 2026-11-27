import { expect, type Page, test } from "@playwright/test";

const path = "**/api/v1/filled-rooms";

async function fill(page: Page) {
  const warm = page.waitForRequest((request) => request.url().endsWith("/api/healthz"));
  await page.goto("/");
  await warm;
  await page.getByRole("tab", { name: "방장이 입력" }).click();
  await page.getByRole("combobox", { name: "나의 출발역" }).fill("강남");
  await page.getByRole("option", { name: /^강남\s?2호선/ }).click();
  await page.getByRole("combobox", { name: "친구1의 출발역" }).fill("홍대입구");
  await page.getByRole("option", { name: /^홍대입구\s?2호선/ }).click();
}

test("채운 방 생성 응답이 끊겨도 같은 시도가 방과 방장 권한을 복구한다", async ({ page }) => {
  const ids: string[] = [];
  await page.route(path, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { roomId: string }).roomId);
    if (ids.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await fill(page);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /연결|오류|다시/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("heading", { name: "내가 만든 방" })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect(new URL(page.url()).pathname).toBe(`/r/${ids[0]}`);
});

test("방장 권한 저장에 실패하면 방으로 가지 않고 만든 방을 지울 수 있다", async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("bby.room.") && key !== "bby.room.probe")
        throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await fill(page);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/v1/filled-rooms"));
  await page.getByRole("button", { name: "방 만들기" }).click();
  const { roomId } = (await (await created).json()) as { roomId: string };
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/방은 만들었지만 방장 권한을 이 기기에 저장하지 못했어요/)).toBeVisible();
  await page.getByRole("button", { name: "만든 방 지우기" }).click();
  await expect(page.getByText("만든 방을 지웠어요.")).toBeVisible();
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(404);
});
