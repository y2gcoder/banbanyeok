import { gotoHydrated, pickStation, ROOM_URL, roomIdOf } from "./lib.mjs";

// features/room-join.md: 방장이 방을 만들고, 친구가 받은 링크로 참여한다. 방장 화면은 새로고침 없이 갱신된다.
export default async ({ page, step, expect, db, newPerson, note }) => {
  await step("home", () => gotoHydrated(page, "/"));
  const panel = page.getByRole("tabpanel", { name: "각자 입력" });
  await step("home-room-form", async () => {
    await expect(page.getByRole("tab", { name: "각자 입력" })).toHaveAttribute("aria-selected", "true");
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await panel.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
    await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  });
  await step("host-waiting", async () => {
    await panel.getByRole("button", { name: "방 만들기" }).click();
    await expect(page).toHaveURL(ROOM_URL);
    await expect(page.getByRole("heading", { name: "내가 만든 방" })).toBeVisible();
    await expect(page.getByText("두 명 이상 들어오면 결과를 볼 수 있어요.")).toBeVisible();
  });
  const roomId = roomIdOf(page);

  await step("host-copies-link", async () => {
    await page.getByRole("button", { name: "링크 복사" }).click();
    await expect(page.getByRole("button", { name: "링크 복사됨" })).toBeVisible();
  });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const { search } = new URL(link);
  expect(search).toMatch(/^\?sv=\d+&pv=\d+$/);
  expect(link).toBe(`${page.url()}${search}`);
  note("shared-link", link);

  const friend = await newPerson();
  await step("friend-opens-link", () => friend.goto(link), { page: friend });
  await expect(friend.getByRole("heading", { name: "나도 출발역 넣기" })).toBeVisible();
  await step(
    "friend-joined",
    async () => {
      await pickStation(friend, "내 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
      await friend.getByRole("button", { name: "참여하기" }).click();
      await expect(friend.getByRole("region", { name: "만날 역 후보" }).getByRole("article").first()).toBeVisible();
    },
    { page: friend },
  );

  await step("host-sees-friend", async () => {
    const people = page.getByRole("region", { name: "들어온 사람" });
    await expect(people.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole("region", { name: "만날 역 후보" }).getByRole("article").first()).toBeVisible();
  });

  const rows = db("participants", `select nickname, origin_code, hidden from participants where room_id = '${roomId}' order by joined_at`);
  expect(rows).toEqual([
    ["민수", "k3a", "f"],
    ["", "ryf", "f"],
  ]);
  await step("same-room-draw-and-decide", async () => {
    await page.getByRole("button", { name: "사다리로 정하기" }).click();
    await page.getByRole("button", { name: "사다리 타기" }).first().click();
    await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
    await expect(page.getByRole("heading", { name: /쪽으로!$/ })).toBeVisible();
    await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
    await expect(page.getByRole("region", { name: /에서 만나요$/ })).toBeVisible();
    expect(roomIdOf(page)).toBe(roomId);
  });
};
