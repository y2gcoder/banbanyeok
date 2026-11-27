import { gotoHydrated, pickStation } from "./lib.mjs";

// features/home-search.md: 첫 화면에서 두 출발역을 고르고 추천 결과를 본다. 결과 보기는 DB에 쓰지 않는다.
export default async ({ page, step, expect, db }) => {
  const [[roomsBefore]] = db("rooms-before", "select count(*) as rooms from rooms");

  await step("home", () => gotoHydrated(page, "/"));
  await page.getByRole("tab", { name: "모두 입력" }).click();
  await expect(page.getByRole("button", { name: "만날 역 찾기" })).toBeVisible();

  await step("origins-picked", async () => {
    await pickStation(page, "나의 출발역", "강남", /^강남\s?2호선/);
    await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  });

  await step("result", async () => {
    await page.getByRole("button", { name: "만날 역 찾기" }).click();
    await expect(page).toHaveURL(/\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=/);
    await expect(page.getByRole("article").first()).toBeVisible();
  });

  const top = page.getByRole("article").first();
  const rows = top.getByRole("listitem");
  await expect(rows.getByText("강남", { exact: true }).first()).toBeVisible();
  await expect(rows.getByText("홍대입구", { exact: true }).first()).toBeVisible();

  await step("top-detail", async () => {
    await top.getByRole("button", { name: /자세히/ }).click();
    await expect(top.getByText(/에서 오는 분/).first()).toBeVisible();
  });

  await step("mode-fast", async () => {
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page).toHaveURL(/m=q/);
    await expect(page.getByRole("tab", { name: "빨리 만나기" })).toHaveAttribute("aria-selected", "true");
  });

  const [[roomsAfter]] = db("rooms-after", "select count(*) as rooms from rooms");
  expect(roomsAfter).toBe(roomsBefore);
};
