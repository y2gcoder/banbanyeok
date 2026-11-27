import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { REGIONAL } from "./support/regions";

/**
 * #170 계산 범위 안내: 첫 화면에서 지원 노선을 바로 알 수 있고, 역 검색에서 결과가 없거나 계산하지 않는 역이면 이유를 알려 준다.
 * 노선 수·목록은 역 인덱스에서 계산하므로 여기서는 숫자를 정규식으로만 본다.
 */
/**
 * `popup`이면 열린 역 목록만 본다. 목록이 열려 있는 동안 Base UI가 바깥을 aria-hidden으로 가리므로(바깥의 포커스 가능한 요소가
 * aria-hidden-focus로 잡힌다) 페이지 전체는 목록이 닫힌 상태에서 따로 본다.
 */
async function expectAccessible(page: Page, popup = false) {
  // 목록은 서서히 나타난다(fade-in). 애니메이션 중에 재면 반투명 글자가 대비 부족으로 잡히므로 끝난 뒤에 잰다.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  if (popup) builder.include('[data-slot="combobox-content"]');
  const { violations } = await builder.analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const scopeButton = (page: Page) => page.getByRole("button", { name: /^수도권 전철 \d+개 노선을 계산해요$/ });

test("첫 화면: 계산 범위 한 줄을 펼치면 노선 배지와 빠진 곳이 보인다(aria-expanded)", async ({ page }) => {
  await page.goto("/");
  const button = scopeButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const panel = page.locator(`#${await button.getAttribute("aria-controls")}`);
  await expect(panel).toBeHidden();
  await expectAccessible(page);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("2호선", { exact: true })).toBeAttached();
  await expect(panel.getByText("수인분당선", { exact: true })).toBeAttached();
  await expect(panel).toContainText("임진강·운천(경의중앙선), 인천자기부상은 아직 계산하지 않아요.");
  await expectAccessible(page);

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

test("수도권 밖 역 이름을 치면 오타 안내 대신 계산 범위와 노선 배지를 보여 준다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "모두 입력" }).click();
  const field = page.getByRole("combobox", { name: "나의 출발역" });
  // 수도권 단독일 때는 부산 역(서면)이, 부산권 공개 뒤에는 어느 권역에도 없는 역(동대구)이 계산 범위 밖이다.
  await field.fill(REGIONAL ? "동대구" : "서면");
  const empty = page.getByRole("status").filter({ hasText: "찾는 역이 없어요" });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/아직 수도권 전철 \d+개 노선만 계산해요\. 이름이 맞는지도 확인해 주세요\./);
  await expect(empty.getByText("2호선", { exact: true })).toBeAttached();
  await expect(page.getByRole("option")).toHaveCount(0);
  await expectAccessible(page, true);
});

test("부산권 공개 뒤에는 수도권에서 부산 역 이름을 치면 부산권으로 바꾸라고 알린다", async ({ page }) => {
  test.skip(!REGIONAL, "부산권 공개 전(수도권 단독)에는 위 테스트가 서면을 계산 범위 밖으로 본다");
  await page.goto("/");
  await page.getByRole("tab", { name: "모두 입력" }).click();
  await page.getByRole("combobox", { name: "나의 출발역" }).fill("서면");
  const elsewhere = page.getByRole("status").filter({ hasText: "부산권에 서면이 있어요" });
  await expect(elsewhere).toBeVisible();
  await expect(elsewhere.getByRole("button", { name: "부산권으로 바꾸기" })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

for (const [query, reason] of [
  ["임진강", "열차가 하루 몇 번뿐인 구간이라 계산하지 않아요"],
  ["용유", "관광용 열차가 띄엄띄엄 다녀서 계산하지 않아요"],
] as const) {
  test(`계산하지 않는 역(${query})은 보이되 고를 수 없고 이유가 붙는다`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "모두 입력" }).click();
    const field = page.getByRole("combobox", { name: "나의 출발역" });
    await field.fill(query);
    const option = page.getByRole("option", { name: new RegExp(`^${query}.*${reason}`) });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expectAccessible(page, true);
    // 눌러도 고르지 않는다: 다른 칸을 채워도 출발역이 한 곳뿐이라 찾기 버튼이 잠겨 있다.
    await option.click({ force: true });
    await expect(option).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(field).not.toHaveAttribute("aria-expanded", "true");
    await page.getByRole("combobox", { name: "친구1의 출발역" }).fill("강남");
    await page.getByRole("option", { name: /^강남\s?2호선/ }).click();
    await expect(page.getByRole("button", { name: "만날 역 찾기" })).toBeDisabled();
  });
}
