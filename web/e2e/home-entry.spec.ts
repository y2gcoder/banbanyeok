import { expect, test } from "@playwright/test";
import { VIEWPORTS } from "./support/viewports";

test("홈 탭: 방향키로 선택하고 Tab으로 열린 패널에 들어간다", async ({ page }) => {
  await page.goto("/");
  const list = page.getByRole("tablist", { name: "출발역 입력 방식" });
  const all = list.getByRole("tab", { name: "모두 입력" });
  const room = list.getByRole("tab", { name: "각자 입력" });
  await expect(all).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName("모두 입력");
  await all.focus();
  await page.keyboard.press("ArrowRight");
  await expect(room).toBeFocused();
  await expect(room).toHaveAttribute("aria-selected", "true");
  await expect(all).toHaveAttribute("aria-selected", "false");
  await expect(room).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Tab");
  const panel = page.getByRole("tabpanel", { name: "각자 입력" });
  await expect(panel).toBeFocused();
  await expect(panel).toContainText("초대 링크로 각자 출발역을 넣어요.");
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("textbox", { name: "내 이름 (선택)" })).toBeFocused();
  await expect(page.getByRole("combobox")).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/);
});

test("홈 탭: 최대 4명과 두 폼의 서로 다른 초안이 유지된다", async ({ page }) => {
  await page.goto("/");
  const allTab = page.getByRole("tab", { name: "모두 입력" });
  const roomTab = page.getByRole("tab", { name: "각자 입력" });
  const all = page.getByRole("tabpanel", { name: "모두 입력" });
  const room = page.getByRole("tabpanel", { name: "각자 입력" });
  await all.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await all.getByRole("combobox", { name: "민수의 출발역" }).fill("강남");
  await page.getByRole("option", { name: /^강남\s?2호선/ }).click();
  const add = all.getByRole("button", { name: /한 명 더 \(최대 4명\)/ });
  await add.click();
  await add.click();
  await expect(add).toHaveCount(0);
  await expect(all.getByRole("combobox")).toHaveCount(4);
  await all.getByRole("textbox", { name: "4번째 사람 이름(선택)" }).fill("서연");

  await roomTab.click();
  const roomName = room.getByRole("textbox", { name: "내 이름 (선택)" });
  const roomStation = room.getByRole("combobox", { name: "내 출발역" });
  await roomName.fill("지연");
  await roomStation.fill("홍대입구");
  await page.getByRole("option", { name: /^홍대입구\s?2호선/ }).click();
  const mode = room.getByRole("radio", { name: /빨리 만나기/ });
  await mode.check();
  await room.getByText("인원 정하기 (선택)").click();
  const count = room.getByRole("button", { name: "3명", exact: true });
  await count.click();

  await allTab.click();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(all).toContainText("바로 추천받고 결과 링크를 보내요.");
  await expect(all.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("강남");
  await expect(all.getByRole("textbox", { name: "4번째 사람 이름(선택)" })).toHaveValue("서연");
  await roomTab.click();
  await expect(roomName).toHaveValue("지연");
  await expect(roomStation).toHaveValue("홍대입구");
  await expect(mode).toBeChecked();
  await expect(count).toHaveAttribute("aria-pressed", "true");
});

test("기존 기기 폭에서 홈 탭은 같은 폭이고 아이콘과 이름이 한 줄에 보인다", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "출발역 입력 방식" }).getByRole("tab");
  for (const { width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    const positions = await tabs.evaluateAll((elements) =>
      elements.map((tab) => {
        const { left, right, width, top } = tab.getBoundingClientRect();
        const icon = tab.querySelector("svg")?.getBoundingClientRect();
        const label = tab.querySelector("span")?.getBoundingClientRect();
        return {
          top,
          width,
          inline: !!icon && !!label && left <= icon.left && icon.right <= label.left && label.right <= right,
        };
      }),
    );
    expect(positions).toHaveLength(2);
    expect(positions[0]?.width).toBeCloseTo(positions[1]?.width ?? 0);
    expect(positions[0]?.top).toBe(positions[1]?.top);
    expect(
      positions.every(({ inline }) => inline),
      `${width}×${height}`,
    ).toBe(true);
  }
  const selected = tabs.first();
  await expect(selected).toHaveCSS("background-color", "rgb(255, 243, 198)");
  await expect(selected).toHaveCSS("color", "rgb(22, 32, 27)");
  await expect(selected.locator("svg")).toHaveCSS("fill", "rgb(245, 197, 24)");
});
