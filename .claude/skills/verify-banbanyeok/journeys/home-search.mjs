import { gotoHydrated, pickStation, ROOM_URL, roomIdOf } from "./lib.mjs";

// features/home-search.md: 두 탭의 초안, 방장이 채운 방, 같은 방에서 공유·사다리·역 정하기, 기존 다시 입력.
export default async ({ page, step, expect, db, newPerson }) => {
  const countRooms = (name) => db(name, "select count(*) from rooms")[0][0];
  const before = countRooms("rooms-before");
  const each = page.getByRole("tab", { name: "각자 입력" });
  const filled = page.getByRole("tab", { name: "방장이 입력" });

  await step("home-keyboard-tabs", async () => {
    await gotoHydrated(page, "/");
    await expect(each).toHaveAttribute("aria-selected", "true");
    await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("따로 쓴 초안");
    await each.focus();
    await each.press("ArrowRight");
    await expect(filled).toBeFocused();
    await expect(filled).toHaveAttribute("aria-selected", "true");
    for (const tab of [each, filled]) {
      expect(await tab.locator("span").evaluate((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getClientRects().length;
      })).toBe(1);
    }
  });

  await step("filled-draft-and-notice", async () => {
    await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
    await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
    await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
    await page.getByRole("radio", { name: "2번" }).check();
    await expect(page.getByText("내 칸 · 방장")).toBeVisible();
    await expect(page.getByText(/친구의 출발역과 이름\(선택\)이 저장돼요/)).toBeVisible();
    await page.getByRole("radio", { name: "토요일" }).check();
    await page.getByRole("radio", { name: /^낮/ }).check();
    await expect(page.getByText(/그다음 날 방이 지워져요/)).toBeVisible();
    await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await filled.focus();
    await filled.press("ArrowLeft");
    await expect(page.getByRole("textbox", { name: "내 이름 (선택)" })).toHaveValue("따로 쓴 초안");
    await each.press("ArrowRight");
    await expect(page.getByRole("textbox", { name: "1번째 사람 이름(선택)" })).toHaveValue("민수");
    await expect(page.getByRole("radio", { name: "2번" })).toBeChecked();
    expect(countRooms("rooms-after-draft")).toBe(before);
  });
  await step("filled-room-result", async () => {
    await page.getByRole("button", { name: "방 만들기" }).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(page.getByRole("region", { name: "만날 역 후보" }).getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
  });
  const roomId = roomIdOf(page);
  const profile = db("filled-room", `select p.origin_code, p.entered_by_host, r.meeting_date is not null,
    r.expires_at = (r.meeting_date + 1)::timestamp at time zone 'Asia/Seoul'
    from rooms r join participants p on p.room_id=r.id
    where r.id='${roomId}' order by p.joined_at`);
  expect(profile).toEqual([["k3a", "t", "t", "t"], ["ryf", "f", "t", "t"]]);
  expect(Number(countRooms("rooms-after-submit"))).toBe(Number(before) + 1);

  const friend = await newPerson();
  await step("filled-room-shared", async () => {
    await page.getByRole("button", { name: "링크 복사" }).click();
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    await friend.goto(shared);
    await expect(friend.getByRole("region", { name: "만날 역 후보" })).toBeVisible();
    await expect(friend.getByRole("button", { name: "사다리로 정하기" })).toHaveCount(0);
  }, { page: friend });

  await step("same-room-draw-and-decide", async () => {
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page.getByRole("tab", { name: "빨리 만나기" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "사다리로 정하기" }).click();
    await page.getByRole("button", { name: "사다리 타기" }).first().click();
    await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
    await expect(page.getByRole("heading", { name: /쪽으로!$/ })).toBeVisible();
    await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
    await expect(page.getByRole("region", { name: /에서 만나요$/ })).toBeVisible();
    expect(roomIdOf(page)).toBe(roomId);
    expect(Number(countRooms("rooms-after-draw"))).toBe(Number(before) + 1);
  });

  await step("old-result-restore-and-prefill", async () => {
    await page.goto("/result?v=2&o=k3a.ryf&m=f&t=saturday-night&n=66-87IiY.");
    await expect(page.getByRole("article").first()).toBeVisible();
    await page.getByRole("link", { name: "다시 입력" }).click();
    await expect(filled).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("강남");
    await expect(page.getByRole("radio", { name: /^밤/ })).toBeChecked();
    await page.goto("/?o=k3a.ryf");
    await expect(filled).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("홍대입구");
    expect(Number(countRooms("rooms-after-legacy"))).toBe(Number(before) + 1);
  });
};
