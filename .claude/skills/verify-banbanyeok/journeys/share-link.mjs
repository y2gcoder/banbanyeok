// features/share.md: 결과 화면의 "링크 복사"로 받은 링크를 친구가 열고 자기가 누구인지 고른다. 공유는 DB에 쓰지 않는다.
export default async ({ page, step, expect, db, newPerson, note }) => {
  const [[roomsBefore]] = db("rooms-before", "select count(*) from rooms");
  await step("result", async () => {
    await page.goto("/result?v=2&o=k3a.ryf&m=f&t=weekday-day");
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "카톡으로 보내기" })).toBeVisible();
  });

  await page.getByRole("button", { name: "링크 복사" }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  note("shared-link", shared);
  expect(shared).toMatch(/\/s\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=/);

  const friend = await newPerson();
  await step(
    "friend-opens-link",
    async () => {
      await friend.goto(shared);
      await expect(friend.getByRole("heading", { name: "친구가 보낸 만날 역 후보" })).toBeVisible();
    },
    { page: friend },
  );
  await step(
    "friend-picks-self",
    async () => {
      await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "홍대입구", exact: true }).click();
      await expect(friend).toHaveURL(/me=1/);
      await expect(friend.getByRole("article").first().getByText("홍대입구(나)").first()).toBeVisible();
    },
    { page: friend },
  );

  const [[roomsAfter]] = db("rooms-after", "select count(*) from rooms");
  expect(roomsAfter).toBe(roomsBefore);
};
