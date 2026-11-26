import { expect, type Locator, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";
import { prepareRoom, type RoomCrowd, type RoomDraw, type RoomScenario } from "./support/room-fixture";

/**
 * 방 화면 첫 화면(#168). 결과가 있는 방은 폰(390×844)에서 스크롤 없이 1위 역 이름·사람별 줄·"이 역으로 정했어요"가 보여야 한다.
 * 참여자 목록·참여 폼·링크 다시 보내기는 결과 아래로 내렸고, 위의 버튼이 그 칸으로 옮겨 가 포커스를 둔다.
 */
const PHONE = { width: 390, height: 844 };
const topCard = (page: Page) => page.locator("article[aria-labelledby='cand-1']");

/** 문서 기준 아래끝(px). 스크롤하지 않은 첫 화면에서 잰다. */
async function bottomOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("보이지 않는 요소");
  return box.y + box.height;
}

test.describe("방 첫 화면에 1위", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  // 사다리 방도 같은 첫 화면 기준을 지킨다. 소개·참여 안내 다음에 재생하고, 끝나면 같은 자리에 접힌다(#224).
  // 이미 본 뽑기와 동작 줄이기는 처음부터 접힌 결과다. 재생 중에는 사다리를 먼저 본다.
  const cases: { scenario: RoomScenario; label: string; draw?: RoomDraw; reduced?: boolean }[] = [
    { scenario: "host-full", label: "방장" },
    { scenario: "hidden-self", label: "출발역을 숨긴 본인" },
    { scenario: "friend-join", label: "링크로 들어와 아직 참여 전" },
    { scenario: "host-full", label: "뽑기 방, 방장, 뽑기 전", draw: "pending" },
    { scenario: "host-full", label: "뽑기 방, 방장, 처음 본 뽑기의 재생이 끝난 뒤", draw: "drawn" },
    { scenario: "host-full", label: "뽑기 방, 방장, 이미 본 뽑기", draw: "drawn-seen" },
    { scenario: "hidden-self", label: "뽑기 방, 숨겨서 빠진 본인, 이미 본 뽑기", draw: "drawn-seen" },
    { scenario: "friend-join", label: "뽑기 방, 참여 전 방문자, 재생이 끝난 뒤", draw: "drawn" },
    { scenario: "friend-join", label: "뽑기 방, 참여 전 방문자, 동작 줄이기", draw: "drawn", reduced: true },
  ];
  for (const { scenario, label, draw, reduced } of cases) {
    test(`${label}: 1위 이름·사람별 줄·정하기 버튼이 스크롤 없이 보인다`, async ({ page }) => {
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(await prepareRoom(page, scenario, undefined, "default", undefined, draw));
      if (draw === "pending") {
        // 뽑기 전: 한 줄 카드가 결과 위에 있다(방장은 거기서 뽑는다).
        await expect(page.getByRole("heading", { name: "누구 쪽으로 뽑기 전" })).toBeInViewport();
      }
      if (draw === "drawn" && !reduced) {
        // 처음 보는 뽑기: 결과 위에서 재생한다.
        await expect(page.getByRole("heading", { name: "뽑는 중…" })).toBeInViewport();
      }
      if (draw && draw !== "pending") {
        const drawCard = page.getByRole("region", { name: "지연이와 함께 오는 아주 긴 이름 쪽으로!" });
        const viewDraw = drawCard.getByRole("button", { name: "사다리 결과 보기", exact: true });
        await expect(viewDraw).toBeInViewport({ ratio: 1, timeout: 6000 });
        expect((await viewDraw.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await expect(page.getByRole("heading", { name: "뽑는 중…" })).toHaveCount(0);
        const meeting = page.getByText("약속 11월 21일 (토) 19:30", { exact: true });
        await expect(meeting).toBeInViewport({ ratio: 1 });
        const topOfDraw = (await drawCard.boundingBox())?.y ?? 0;
        expect(await bottomOf(meeting)).toBeLessThanOrEqual(topOfDraw);
        if (scenario === "friend-join") {
          const join = page.getByRole("button", { name: "나도 출발역 넣기" });
          await expect(join).toBeInViewport({ ratio: 1 });
          expect((await join.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          expect(await bottomOf(join)).toBeLessThanOrEqual(topOfDraw);
        }
        const resultTitle = page.getByRole("heading", { name: "만날 역 후보" });
        expect(await bottomOf(drawCard)).toBeLessThanOrEqual((await resultTitle.boundingBox())?.y ?? 0);
        await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
      }
      const card = topCard(page);
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(card.getByRole("heading", { name: "동대문역사문화공원" })).toBeInViewport({ ratio: 1 });
      // 사람별 요약 줄(3명) 마지막 줄까지.
      const rows = card.locator("ul").first().locator(":scope > li");
      await expect(rows).toHaveCount(3);
      expect(await bottomOf(rows.last())).toBeLessThanOrEqual(PHONE.height);
      // 정하기는 화면에 따라 버튼(정하기) 또는 링크(바로 길찾기)다.
      const name = "이 역으로 정했어요";
      const decide = card.getByRole("button", { name }).or(card.getByRole("link", { name }));
      expect(await bottomOf(decide)).toBeLessThanOrEqual(PHONE.height);
      expect(await horizontalOverflow(page)).toEqual([]);
    });
  }

  test("결과 위 버튼: 들어온 사람 목록으로 옮겨 가 제목에 포커스를 둔다(44px 이상)", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-full"));
    const jump = page.getByRole("button", { name: "들어온 사람 3/4명" });
    await expect(jump).toBeInViewport();
    expect((await jump.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await jump.click();
    const title = page.getByRole("heading", { name: "들어온 사람", level: 2 });
    await expect(title).toBeFocused();
    await expect(title).toBeInViewport();
    // 방장의 수정·내보내기는 목록에 그대로 있다.
    await expect(page.getByRole("button", { name: "수정 내 항목" })).toBeVisible();
  });

  test("아직 참여 전: '나도 출발역 넣기'가 결과 아래 참여 폼으로 옮겨 가 이름 칸에 포커스를 둔다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "friend-join"));
    await expect(topCard(page)).toBeVisible();
    const cta = page.getByRole("button", { name: "나도 출발역 넣기" });
    await expect(cta).toBeInViewport();
    expect((await cta.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await cta.click();
    const form = page.getByRole("form", { name: "나도 출발역 넣기" });
    await expect(form.getByRole("textbox", { name: /이름 \(선택\)/ })).toBeFocused();
    await expect(form.getByRole("combobox", { name: "내 출발역" })).toBeInViewport();
  });

  test("혼자인 방(결과 전)은 링크 보내기가 맨 위이고 옮겨 가는 버튼이 없다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-alone"));
    await expect(page.getByRole("heading", { name: "친구에게 링크를 보내 주세요" })).toBeInViewport();
    await expect(
      page.getByText("각자 출발역을 넣으면 모두에게 공평한 만날 역을 지하철 시간으로 계산해요."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /들어온 사람 \d/ })).toHaveCount(0);
  });

  test("혼자인 방에서 넣는 중에 두 번째 사람이 들어와 결과가 생겨도 참여 폼은 그대로다(이름·역 검색어·포커스)", async ({
    page,
  }) => {
    const crowd: RoomCrowd = { alone: true };
    await page.clock.install({ time: new Date("2026-11-16T03:00:00Z") });
    await page.goto(await prepareRoom(page, "friend-alone", undefined, "default", crowd));
    await expect(page.getByText("두 명 이상 들어오면 결과를 볼 수 있어요.")).toBeVisible();
    const form = page.getByRole("form", { name: "나도 출발역 넣기" });
    const name = form.getByRole("textbox", { name: "내 이름 (선택)" });
    await name.fill("서연");
    const station = form.getByRole("combobox", { name: "내 출발역" });
    // 역 검색 목록이 열리면 나머지 화면은 접근성 트리에서 가려지므로, 열기 전에 요소를 쥐고 그 요소로 확인한다.
    const [formNode, nameNode, stationNode] = await Promise.all([
      form.elementHandle(),
      name.elementHandle(),
      station.elementHandle(),
    ]);
    await station.pressSequentially("신");

    // 두 번째 사람이 들어왔다: 다음 폴링(15초)에 방이 세 명으로 온다.
    crowd.alone = false;
    const polled = page.waitForRequest((req) => new URL(req.url()).pathname.endsWith("/rooms/qt7yvmsht3"));
    await page.clock.fastForward(15_500);
    await polled;
    await expect(topCard(page)).toBeAttached();

    // 같은 요소가 문서에 그대로 남아 있다(다시 그려졌다면 떨어져 나간다). 넣던 값과 포커스도 그대로.
    const after = await page.evaluate(
      ([formEl, nameEl, stationEl]) => {
        const card = document.querySelector("article[aria-labelledby='cand-1']");
        return {
          connected: [formEl, nameEl, stationEl].every((el) => (el as Element).isConnected),
          focused: document.activeElement === stationEl,
          name: (nameEl as HTMLInputElement).value,
          station: (stationEl as HTMLInputElement).value,
          // 읽는 순서도 화면 순서와 같다: 결과 다음에 참여 폼.
          formAfterResult: Boolean(
            card && card.compareDocumentPosition(formEl as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        };
      },
      [formNode, nameNode, stationNode] as const,
    );
    expect(after).toEqual({ connected: true, focused: true, name: "서연", station: "신", formAfterResult: true });
  });
});
