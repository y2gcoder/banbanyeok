import AxeBuilder from "@axe-core/playwright";
import { devices, expect, type Page, test } from "@playwright/test";

/**
 * '누구 쪽으로' 뽑기(#172) e2e: 실제 서버(Ktor + DB)에서 방장이 뽑기 방을 만들고, 친구 둘(한 명은 출발역을 숨김)이 들어온 뒤 뽑는다.
 * 운은 서버가 정하므로 누가 뽑힐지는 모른다. 대신 숨긴 사람은 대상에 없고, 다른 기기에서 열어도 같은 사람이 보이며, 새로고침해도
 * 바뀌지 않는지 본다.
 */
const GANGNAM = "k3a";
const SINCHON = "1qs";
const ROOM_URL = /\/r\/([0-9a-hjkmnp-tv-z]{10})$/;

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

type ApiRoom = {
  favorTarget: string | null;
  participants: { participantId: string; shortLabel: string; hidden: boolean }[];
  favorDraw: { generation: number; round: number; candidates: string[]; winner: string | null } | null;
};

test("뽑기 방: 숨긴 사람은 빠지고, 방장이 뽑은 결과가 다른 기기에서도 같고 새로고침해도 그대로다", async ({
  page,
  browser,
  request,
}, testInfo) => {
  // 방 만들기 화면이 붙으면(수화) 서버를 깨운다. 그 요청을 본 뒤에 입력한다.
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp;
  await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
  await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  await page.getByRole("radio", { name: /누구 쪽으로/ }).check();
  await page.getByRole("button", { name: "뽑기로 정하기" }).click();
  await expect(page.getByText("누구 쪽으로 할지 뽑기로 정해요. 모두 들어오면 내가 뽑아요")).toBeVisible();
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(ROOM_URL);
  const roomId = new URL(page.url()).pathname.split("/").pop() ?? "";

  // 친구 둘: 지영(신촌, 공개)과 출발역을 숨긴 사람(강남).
  for (const body of [
    { nickname: "지영", originCode: SINCHON, hidden: false },
    { originCode: GANGNAM, hidden: true },
  ]) {
    const res = await request.post(`/api/v1/rooms/${roomId}/participants`, { data: body });
    expect(res.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "누구 쪽으로 뽑기 전" })).toBeVisible();
  await expect(page.getByText("누구 쪽으로(뽑기 전)")).toBeVisible();
  await page.getByRole("button", { name: "뽑기 자세히 보기" }).click();
  await expect(page.getByText(/출발역을 숨겨서 뽑기에서 빠졌어요/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "사다리 타기" }).first().click();
  await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
  // 재생이 끝나면 카드는 접혀 후보 아래로 가고 초점은 결과 제목(1위 카드 바로 위)에 있다.
  const heading = page.getByRole("heading", { name: /쪽으로!$/ });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", { name: "만날 역 후보" })).toBeFocused();

  const stored = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as ApiRoom;
  const draw = stored.favorDraw;
  expect(draw?.round).toBe(1);
  const hiddenId = stored.participants.find((p) => p.hidden)?.participantId;
  expect(draw?.candidates).toHaveLength(2);
  expect(draw?.candidates).not.toContain(hiddenId);
  expect(stored.favorTarget).toBe(draw?.winner);
  const winnerName = stored.participants.find((p) => p.participantId === draw?.winner)?.shortLabel ?? "";
  await expect(heading).toHaveText(`${winnerName} 쪽으로!`);
  await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
  await expectNoA11yViolations(page);

  // 다른 기기(친구): 처음 보는 뽑기라 한 번 저절로 재생한 뒤 같은 사람이 접힌 한 줄로 보이고, 펼치면 같은 사다리다.
  const friend = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "ko-KR",
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  const other = await friend.newPage();
  await other.goto(`/r/${roomId}`);
  await expect(other.getByRole("heading", { name: "뽑는 중…" })).toBeVisible();
  await expect(other.getByRole("heading", { name: `${winnerName} 쪽으로!` })).toBeVisible({ timeout: 8000 });
  await other.getByRole("button", { name: "사다리 보기" }).click();
  await expect(other.getByRole("img", { name: `사다리타기 결과: ${winnerName} 쪽으로` })).toBeVisible();
  await expect(other.getByRole("button", { name: "사다리 타기" })).toHaveCount(0);
  await friend.close();

  // 새로고침해도 같은 결과(서버에 저장), 방장 화면에서 다시 뽑기는 한 번 남았다.
  await page.reload();
  await expect(page.getByRole("heading", { name: `${winnerName} 쪽으로!` })).toBeVisible();
  await page.getByRole("button", { name: "사다리 보기" }).click();
  await expect(page.getByRole("button", { name: "다시 뽑기 (1번 남음)" })).toBeVisible();
});
