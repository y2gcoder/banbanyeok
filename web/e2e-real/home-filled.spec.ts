import { expect, type Page, test } from "@playwright/test";
import { hideAsBefore } from "./legacy-hidden";

const path = "**/api/v1/filled-rooms";

async function fill(page: Page) {
  const warm = page.waitForRequest((request) => request.url().endsWith("/api/healthz"));
  await page.goto("/");
  await warm;
  await page.getByRole("tab", { name: "방장이 입력" }).click();
  await page.getByRole("combobox", { name: "나의 출발역" }).fill("강남");
  await page.getByRole("option", { name: /^강남\s?2호선/ }).click();
  await page.getByRole("combobox", { name: "친구1의 출발역" }).fill("홍대입구");
  await page.getByRole("option", { name: /^홍대입구\s?2호선/ }).click();
}

test("채운 방 생성 응답이 끊겨도 같은 시도가 방과 방장 권한을 복구한다", async ({ page }) => {
  const ids: string[] = [];
  await page.route(path, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { roomId: string }).roomId);
    if (ids.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await fill(page);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /연결|오류|다시/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("heading", { name: "내가 만든 방" })).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  expect(new URL(page.url()).pathname).toBe(`/r/${ids[0]}`);
});

test("숨긴 참가자가 남은 채운 방을 복구하면 두 탭에서 방장 삭제 권한을 지킨다", async ({ page, request }) => {
  type Created = { roomId: string; hostToken: string; participantId: string; participantToken: string };
  const responses: Created[] = [];
  await page.route(path, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    responses.push((await response.json()) as Created);
    if (responses.length === 1) await route.abort();
    else await route.fulfill({ response });
  });
  await fill(page);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /연결|오류|다시/ })).toBeVisible();
  const created = responses[0];
  if (!created) throw new Error("첫 방 생성 응답이 있어야 한다");

  // 지금은 만들 수 없는 상태를 가상 DB에 복원한다. 방장의 내 항목은 그 뒤 정상 삭제한 상태다.
  const room = `/api/v1/rooms/${created.roomId}`;
  const publicRoom = (await (await request.get(room)).json()) as {
    participants: { participantId: string; enteredByHost?: boolean }[];
  };
  const friend = publicRoom.participants.find((participant) => participant.enteredByHost);
  if (!friend) throw new Error("방장이 대신 넣은 참가자가 있어야 한다");
  hideAsBefore(created.roomId, friend.participantId);
  const removed = await request.delete(`${room}/participants/${created.participantId}`, {
    headers: { authorization: `Bearer ${created.participantToken}` },
  });
  expect(removed.status()).toBe(204);
  for (const path of [room, `${room}/result`, `${room}/preview`]) {
    const visitor = await request.get(path);
    expect(visitor.status(), path).toBe(404);
    expect(await visitor.json()).toMatchObject({ code: "ROOM_NOT_FOUND" });
  }

  // 첫 탭의 늦은 404가 두 번째 탭이 이미 고친 방장 기록을 지우지 않아야 한다.
  const firstNotFound = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(`**${room}`, async (route) => {
    const response = await route.fetch();
    if (response.status() === 404) {
      firstNotFound.resolve();
      await release.promise;
    }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "방 만들기" }).click();
  const second = await page.context().newPage();
  try {
    await firstNotFound.promise;
    expect(responses.map((response) => response.roomId)).toEqual([created.roomId, created.roomId]);
    await second.goto(`/r/${created.roomId}`);
    await expect(second.getByRole("heading", { name: "지금은 열 수 없는 방이에요" })).toBeVisible();
    await expect(second.getByRole("button", { name: "방 삭제 방 전체" })).toBeVisible();
    await expect(second.getByRole("button", { name: "삭제 내 항목" })).toHaveCount(0);
  } finally {
    release.resolve();
  }
  await expect(page.getByRole("heading", { name: "지금은 열 수 없는 방이에요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "방 삭제 방 전체" })).toBeVisible();
  await expect(page.getByRole("region", { name: "만날 역 후보" })).toHaveCount(0);
  await second.getByRole("button", { name: "방 삭제 방 전체" }).click();
  await second.getByRole("button", { name: "방 지우기", exact: true }).click();
  await expect(second).toHaveURL(/\/$/);
  const deleted = await request.get(room, { headers: { authorization: `Bearer ${created.hostToken}` } });
  expect(deleted.status()).toBe(404);
});

test("방장 권한 저장에 실패하면 방으로 가지 않고 만든 방을 지울 수 있다", async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("bby.room.") && key !== "bby.room.probe")
        throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await fill(page);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/v1/filled-rooms"));
  await page.getByRole("button", { name: "방 만들기" }).click();
  const { roomId } = (await (await created).json()) as { roomId: string };
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/방은 만들었지만 방장 권한을 이 기기에 저장하지 못했어요/)).toBeVisible();
  await page.getByRole("button", { name: "만든 방 지우기" }).click();
  await expect(page.getByText("만든 방을 지웠어요.")).toBeVisible();
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(404);
});
