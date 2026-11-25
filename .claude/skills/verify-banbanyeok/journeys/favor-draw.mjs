import { gotoHydrated, pickStation, ROOM_URL, roomIdOf } from "./lib.mjs";

// features/favor-draw.md: '누구 쪽으로'를 뽑기로 정하는 방. 친구가 들어온 뒤 방장이 사다리를 타고, 결과가 저장돼 친구 화면에도 같다.
export default async ({ page, step, expect, db, newPerson }) => {
  await step("room-new-draw", async () => {
    await gotoHydrated(page, "/r/new");
    await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
    await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
    await page.getByRole("radio", { name: /누구 쪽으로/ }).check();
    await page.getByRole("button", { name: "뽑기로 정하기" }).click();
    await expect(page.getByText("누구 쪽으로 할지 뽑기로 정해요. 모두 들어오면 내가 뽑아요")).toBeVisible();
  });
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(ROOM_URL);
  const roomId = roomIdOf(page);

  const friend = await newPerson();
  await step(
    "friend-joined",
    async () => {
      await friend.goto(`/r/${roomId}`);
      await friend.getByRole("textbox", { name: "내 이름 (선택)" }).fill("지영");
      await pickStation(friend, "내 출발역", "신촌", /^신촌\s?2호선/);
      await friend.getByRole("button", { name: "참여하기" }).click();
      await expect(friend.getByRole("region", { name: "들어온 사람" }).getByRole("listitem")).toHaveCount(2);
    },
    { page: friend },
  );

  await step("host-before-draw", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "누구 쪽으로 뽑기 전" })).toBeVisible();
  });
  const heading = page.getByRole("heading", { name: /쪽으로!$/ });
  await step("host-drew", async () => {
    await page.getByRole("button", { name: "사다리 타기" }).first().click();
    await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
    await expect(heading).toBeVisible();
    await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
  });
  const [[favorDraw, round, winnerName]] = db(
    "room-draw",
    `select r.favor_draw, r.draw_round, p.nickname from rooms r
       join participants p on p.room_id = r.id and p.pid = r.favor_pid
      where r.id = '${roomId}'`,
  );
  expect([favorDraw, round]).toEqual(["t", "1"]);
  expect(["민수", "지영"]).toContain(winnerName);
  await expect(heading).toHaveText(`${winnerName} 쪽으로!`);

  await step(
    "friend-sees-same-winner",
    async () => {
      await friend.reload();
      await expect(friend.getByRole("heading", { name: /쪽으로!$/ })).toHaveText(`${winnerName} 쪽으로!`);
    },
    { page: friend },
  );
};
