// features/last-train.md: 결과 1위 카드의 "집에 가는 막차". 광교·부천 평일 밤은 dev 산출물에서 갈아타는 길(10분 단위로 내림)과
// 계산하지 않는 길이 함께 나오는 고정 사례다.
export default async ({ page, step, expect }) => {
  const top = page.getByRole("article").first();
  await step("result-weekday-night", async () => {
    await page.goto("/result?v=2&o=dzc.ry7&m=f&t=weekday-night");
    await expect(top.getByText("공개된 시각 중 가장 이름: 부천 23:00 · 더 확인할 분 있음").first()).toBeVisible();
  });
  const lastTrain = top.getByRole("region", { name: "집에 가는 막차" });
  await step("last-train-detail", async () => {
    await top.getByRole("button", { name: /자세히/ }).click();
    await expect(lastTrain.getByText("평일 시간표")).toBeVisible();
  });
  const rows = lastTrain.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("광교이 경로는 막차 계산 전.");
  await expect(rows.nth(0)).not.toContainText(/\d\d:\d\d/);
  await expect(rows.nth(1)).toContainText("부천늦어도23:00출발");
  await expect(rows.nth(1).getByRole("link", { name: "부천, 지도 앱에서 막차 확인하기" })).toHaveAttribute(
    "href",
    /^https:\/\/map\.kakao\.com\/link\/by\/traffic\//,
  );
};
